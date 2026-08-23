import { Injectable } from '@nestjs/common';
import { Device, Prisma, RefreshToken, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateRefreshTokenInput {
  userId: string;
  deviceId?: string | null;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: CreateRefreshTokenInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<RefreshToken> {
    return tx.refreshToken.create({ data });
  }

  findByTokenHashWithUser(
    tokenHash: string,
  ): Promise<(RefreshToken & { user: User }) | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  /**
   * The live session on some other device, if any — the signal that a login
   * from a new device needs email verification first (ADR-0017).
   */
  findActiveOnOtherDevice(
    userId: string,
    deviceId: string | null,
    now: Date,
  ): Promise<(RefreshToken & { device: Device | null }) | null> {
    return this.prisma.refreshToken.findFirst({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        ...(deviceId ? { NOT: { deviceId } } : {}),
      },
      include: { device: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Revoking the current token and creating its successor must commit
  // together — a crash between the two would either resurrect a rotated
  // token or duplicate a session. Kept inside the repository so callers
  // never see the transaction.
  async rotate(
    currentId: string,
    replacedByHash: string,
    next: CreateRefreshTokenInput,
  ): Promise<RefreshToken> {
    const [, created] = await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: currentId },
        data: { revokedAt: new Date(), replacedBy: replacedByHash },
      }),
      this.prisma.refreshToken.create({ data: next }),
    ]);
    return created;
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
