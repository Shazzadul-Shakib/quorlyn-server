import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ChallengePurpose, User } from '@prisma/client';
import { CLOCK, type Clock } from '../clock/clock';
import { DeviceRepository } from '../repositories/device.repository';
import { EmailChallengeRepository } from '../repositories/email-challenge.repository';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { PrismaTransactionRunner } from '../prisma/transaction-runner';
import { MAILER } from '../mailer/mailer.interface';
import type { MailerService } from '../mailer/mailer.interface';
import { hashToken } from '../utils/token.util';
import { generateVerificationCode } from '../utils/verification-code.util';

export const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;

export class DeviceConflictError extends ConflictException {
  constructor(activeDevice: { label: string | null; lastSeenAt: Date }) {
    super({
      statusCode: 409,
      code: 'DEVICE_CONFLICT',
      message:
        'This account is already signed in on another device. Verify by email to move it here.',
      activeDevice,
    });
  }
}

/**
 * Owns everything about "which device holds this account's session"
 * (ADR-0017): binding, conflict detection, and the emailed code that releases
 * a session from the old device.
 */
@Injectable()
export class DeviceSessionService {
  constructor(
    private readonly deviceRepository: DeviceRepository,
    private readonly emailChallengeRepository: EmailChallengeRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly transactionRunner: PrismaTransactionRunner,
    @Inject(MAILER) private readonly mailer: MailerService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Resolves the device row to bind the new session to, or refuses when the
   * account is enforced and a live session exists elsewhere.
   */
  async resolveForLogin(
    user: User,
    rawDeviceId: string | null,
    label?: string,
  ): Promise<string | null> {
    if (!rawDeviceId) {
      if (user.singleDeviceEnforced) {
        throw new BadRequestException(
          'This account requires a device identifier; send the X-Device-Id header.',
        );
      }
      return null;
    }

    const deviceIdHash = hashToken(rawDeviceId);
    const known = await this.deviceRepository.findActiveByUserAndHash(
      user.id,
      deviceIdHash,
    );

    if (user.singleDeviceEnforced && !known) {
      const active = await this.refreshTokenRepository.findActiveOnOtherDevice(
        user.id,
        null,
        this.clock.now(),
      );
      if (active) {
        throw new DeviceConflictError({
          label: active.device?.label ?? null,
          lastSeenAt: active.device?.lastSeenAt ?? active.createdAt,
        });
      }
    }

    const device = await this.deviceRepository.upsert({
      userId: user.id,
      deviceIdHash,
      label,
    });
    await this.deviceRepository.touch(device.id, this.clock.now());
    return device.id;
  }

  async requestDeviceChange(user: User, label?: string): Promise<void> {
    const now = this.clock.now();
    const recent = await this.emailChallengeRepository.countRecent(
      user.id,
      ChallengePurpose.DEVICE_CHANGE,
      new Date(now.getTime() - 60 * 60 * 1000),
    );
    if (recent >= MAX_CODES_PER_HOUR) {
      throw new HttpException(
        'Too many verification codes requested; try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = generateVerificationCode();
    await this.emailChallengeRepository.consumeAllForUser(
      user.id,
      ChallengePurpose.DEVICE_CHANGE,
      now,
    );
    await this.emailChallengeRepository.create({
      userId: user.id,
      purpose: ChallengePurpose.DEVICE_CHANGE,
      codeHash: hashToken(code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000),
    });

    // Unlike invite mail this is not best-effort: a code that never arrives
    // is a locked-out student, so the failure reaches the caller.
    await this.mailer.sendDeviceChangeCode({
      to: user.email,
      code,
      expiresInMinutes: CODE_TTL_MINUTES,
      newDeviceLabel: label,
    });
  }

  /**
   * Verifies the emailed code, then leaves exactly one live device: every
   * refresh token and every device row is revoked before the new one binds.
   */
  async verifyDeviceChange(
    user: User,
    code: string,
    rawDeviceId: string,
    label?: string,
  ): Promise<string> {
    const now = this.clock.now();
    const challenge = await this.emailChallengeRepository.findLatestUnconsumed(
      user.id,
      ChallengePurpose.DEVICE_CHANGE,
    );
    if (!challenge) {
      throw new BadRequestException('Request a verification code first');
    }
    if (challenge.expiresAt <= now) {
      throw new BadRequestException('Verification code has expired');
    }
    if (challenge.attempts >= MAX_CODE_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts; request a new code',
      );
    }
    if (challenge.codeHash !== hashToken(code)) {
      await this.emailChallengeRepository.incrementAttempts(challenge.id);
      throw new BadRequestException('Incorrect verification code');
    }

    return this.transactionRunner.run(async (tx) => {
      const consumed = await this.emailChallengeRepository.consume(
        challenge.id,
        now,
        tx,
      );
      if (!consumed) {
        throw new BadRequestException(
          'Verification code has already been used',
        );
      }

      await this.refreshTokenRepository.revokeAllForUser(user.id, tx);
      await this.deviceRepository.revokeAllForUser(user.id, now, tx);
      const device = await this.deviceRepository.upsert(
        { userId: user.id, deviceIdHash: hashToken(rawDeviceId), label },
        tx,
      );
      return device.id;
    });
  }
}
