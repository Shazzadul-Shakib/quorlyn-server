import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { EnvConfig } from '../config/env.validation';
import { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { generateOpaqueToken, hashToken } from '../utils/token.util';
import { parseDurationToSeconds } from '../utils/duration.util';
import { JwtPayload, TokenPair } from './jwt-payload.interface';

export interface RefreshTokenMeta {
  userAgent?: string;
  ipAddress?: string;
}

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

  private signAccessToken(
    user: Pick<User, 'id' | 'role' | 'organizationId' | 'isOrgOwner'>,
  ): string {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      organizationId: user.organizationId,
      isOrgOwner: user.isOrgOwner,
    };
    return this.jwtService.sign(payload);
  }

  async issueTokenPair(
    user: Pick<User, 'id' | 'role' | 'organizationId' | 'isOrgOwner'>,
    meta: RefreshTokenMeta = {},
  ): Promise<TokenPair> {
    const accessToken = this.signAccessToken(user);
    const rawRefreshToken = generateOpaqueToken();

    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: hashToken(rawRefreshToken),
      expiresAt: new Date(Date.now() + this.refreshTokenTtlMs),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      accessTokenExpiresIn: this.accessTokenExpiresIn,
    };
  }

  async rotateRefreshToken(
    rawToken: string,
    meta: RefreshTokenMeta = {},
  ): Promise<TokenPair> {
    const tokenHash = hashToken(rawToken);
    const existing =
      await this.refreshTokenRepository.findByTokenHashWithUser(tokenHash);

    if (!existing || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (existing.revokedAt) {
      // Reuse of an already-rotated token: likely theft. Revoke every session for this user.
      await this.revokeAllUserTokens(existing.userId);
      throw new UnauthorizedException(
        'Refresh token reuse detected; all sessions revoked',
      );
    }

    const accessToken = this.signAccessToken(existing.user);
    const rawNewRefreshToken = generateOpaqueToken();
    const newTokenHash = hashToken(rawNewRefreshToken);

    await this.refreshTokenRepository.rotate(existing.id, newTokenHash, {
      userId: existing.userId,
      tokenHash: newTokenHash,
      expiresAt: new Date(Date.now() + this.refreshTokenTtlMs),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    return {
      accessToken,
      refreshToken: rawNewRefreshToken,
      accessTokenExpiresIn: this.accessTokenExpiresIn,
    };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    await this.refreshTokenRepository.revokeByTokenHash(hashToken(rawToken));
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository.revokeAllForUser(userId);
  }
}
