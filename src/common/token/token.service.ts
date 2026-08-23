import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { EnvConfig } from '../config/env.validation';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { generateOpaqueToken, hashToken } from '../utils/token.util';
import { parseDurationToSeconds } from '../utils/duration.util';
import { JwtPayload, OrgClaim, TokenPair } from './jwt-payload.interface';

export interface RefreshTokenMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssueTokenPairOptions {
  org?: OrgClaim | null;
  deviceId?: string | null;
  meta?: RefreshTokenMeta;
}

type TokenUser = Pick<User, 'id' | 'platformRole'>;

@Injectable()
export class TokenService {
  private readonly accessTokenExpiresIn: number;
  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    configService: ConfigService<EnvConfig, true>,
  ) {
    this.accessTokenExpiresIn = parseDurationToSeconds(
      configService.get('JWT_ACCESS_TTL', { infer: true }),
    );
    this.refreshTokenTtlMs =
      configService.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) *
      24 *
      60 *
      60 *
      1000;
  }

  get accessTokenLifetimeSeconds(): number {
    return this.accessTokenExpiresIn;
  }

  signAccessToken(
    user: TokenUser,
    org: OrgClaim | null,
    deviceId: string | null,
  ): string {
    const payload: JwtPayload = {
      sub: user.id,
      platformRole: user.platformRole,
      deviceId,
      org,
    };
    return this.jwtService.sign(payload);
  }

  async issueTokenPair(
    user: TokenUser,
    options: IssueTokenPairOptions = {},
  ): Promise<TokenPair> {
    const deviceId = options.deviceId ?? null;
    const accessToken = this.signAccessToken(
      user,
      options.org ?? null,
      deviceId,
    );
    const rawRefreshToken = generateOpaqueToken();

    await this.refreshTokenRepository.create({
      userId: user.id,
      deviceId,
      tokenHash: hashToken(rawRefreshToken),
      expiresAt: new Date(Date.now() + this.refreshTokenTtlMs),
      userAgent: options.meta?.userAgent,
      ipAddress: options.meta?.ipAddress,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      accessTokenExpiresIn: this.accessTokenExpiresIn,
    };
  }

  /**
   * Rotation with reuse detection (ADR-0001). The organization claim is
   * supplied by the caller, which has just re-read the membership, so a
   * revoked membership cannot outlive one access-token lifetime.
   */
  async rotateRefreshToken(
    rawRefreshToken: string,
    org: OrgClaim | null,
    meta: RefreshTokenMeta = {},
  ): Promise<TokenPair> {
    const stored = await this.refreshTokenRepository.findByTokenHashWithUser(
      hashToken(rawRefreshToken),
    );
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // A token that was already rotated is being replayed: treat the whole
    // session family as compromised.
    if (stored.revokedAt) {
      await this.refreshTokenRepository.revokeAllForUser(stored.userId);
      throw new UnauthorizedException(
        'Refresh token reuse detected; all sessions revoked',
      );
    }

    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (!stored.user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const nextRawToken = generateOpaqueToken();
    const nextHash = hashToken(nextRawToken);
    await this.refreshTokenRepository.rotate(stored.id, nextHash, {
      userId: stored.userId,
      deviceId: stored.deviceId,
      tokenHash: nextHash,
      expiresAt: new Date(Date.now() + this.refreshTokenTtlMs),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    return {
      accessToken: this.signAccessToken(stored.user, org, stored.deviceId),
      refreshToken: nextRawToken,
      accessTokenExpiresIn: this.accessTokenExpiresIn,
    };
  }

  async peekUserIdAndOrg(
    rawRefreshToken: string,
  ): Promise<{ userId: string; platformRole: User['platformRole'] } | null> {
    const stored = await this.refreshTokenRepository.findByTokenHashWithUser(
      hashToken(rawRefreshToken),
    );
    return stored
      ? { userId: stored.userId, platformRole: stored.user.platformRole }
      : null;
  }

  async revokeRefreshToken(rawRefreshToken: string): Promise<void> {
    await this.refreshTokenRepository.revokeByTokenHash(
      hashToken(rawRefreshToken),
    );
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository.revokeAllForUser(userId);
  }
}
