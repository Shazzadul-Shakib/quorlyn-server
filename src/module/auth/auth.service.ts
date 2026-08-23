import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { UserRepository } from '../../common/repositories/user.repository';
import { MembershipRepository } from '../../common/repositories/membership.repository';
import { OrgClaimService } from '../../common/token/org-claim.service';
import {
  RefreshTokenMeta,
  TokenService,
} from '../../common/token/token.service';
import { comparePassword } from '../../common/utils/password.util';
import {
  toMembershipSummary,
  toUserSummary,
} from '../../common/utils/user-summary.util';
import { SessionService } from '../../common/session/session.service';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { TokenPairResponseDto } from '../../common/dto/token-pair-response.dto';
import type {
  AuthenticatedUser,
  OrgClaim,
} from '../../common/token/jwt-payload.interface';
import { DeviceSessionService } from '../../common/session/device-session.service';
import { MeResponseDto } from './dto/me-response.dto';
import { SelectOrganizationResponseDto } from './dto/select-organization-response.dto';

export interface LoginContext extends RefreshTokenMeta {
  deviceId: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly tokenService: TokenService,
    private readonly orgClaimService: OrgClaimService,
    private readonly deviceSessionService: DeviceSessionService,
    private readonly sessionService: SessionService,
  ) {}

  async login(
    email: string,
    password: string,
    context: LoginContext,
  ): Promise<AuthTokensResponseDto> {
    const user = await this.verifyCredentials(email, password);
    return this.sessionService.start(user, context);
  }

  async requestDeviceChange(
    email: string,
    password: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.verifyCredentials(email, password);
    await this.deviceSessionService.requestDeviceChange(user, userAgent);
  }

  async verifyDeviceChange(
    email: string,
    password: string,
    code: string,
    context: LoginContext,
  ): Promise<AuthTokensResponseDto> {
    const user = await this.verifyCredentials(email, password);
    if (!context.deviceId) {
      throw new UnauthorizedException('Missing X-Device-Id header');
    }
    const deviceId = await this.deviceSessionService.verifyDeviceChange(
      user,
      code,
      context.deviceId,
      context.userAgent,
    );
    return this.sessionService.startWithDevice(user, deviceId, context);
  }

  async selectOrganization(
    currentUser: AuthenticatedUser,
    organizationId: string,
  ): Promise<SelectOrganizationResponseDto> {
    const org = await this.orgClaimService.resolveOrThrow(
      currentUser.sub,
      organizationId,
      currentUser.platformRole,
    );
    const user = await this.requireUser(currentUser.sub);
    return {
      accessToken: this.tokenService.signAccessToken(
        user,
        org,
        currentUser.deviceId,
      ),
      accessTokenExpiresIn: this.tokenService.accessTokenLifetimeSeconds,
      org,
    };
  }

  /**
   * The organization claim is re-resolved from the database on every refresh,
   * so a suspended membership stops working within one access-token lifetime
   * (ADR-0007). A lost membership degrades the token to org-less rather than
   * failing the refresh, which would strand the client.
   */
  async refresh(
    rawRefreshToken: string,
    organizationId: string | undefined,
    meta: RefreshTokenMeta,
  ): Promise<TokenPairResponseDto> {
    let org: OrgClaim | null = null;
    if (organizationId) {
      const session = await this.tokenService.peekUserIdAndOrg(rawRefreshToken);
      if (session) {
        org = await this.orgClaimService.resolveOrNull(
          session.userId,
          organizationId,
          session.platformRole,
        );
      }
    }
    return this.tokenService.rotateRefreshToken(rawRefreshToken, org, meta);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokenService.revokeRefreshToken(rawRefreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokenService.revokeAllUserTokens(userId);
  }

  async me(currentUser: AuthenticatedUser): Promise<MeResponseDto> {
    const user = await this.requireUser(currentUser.sub);
    const memberships =
      await this.membershipRepository.findManyByUserWithOrganization(user.id);
    return {
      user: toUserSummary(user),
      memberships: memberships.map(toMembershipSummary),
      org: currentUser.org,
    };
  }

  private async verifyCredentials(
    email: string,
    password: string,
  ): Promise<User> {
    const user = await this.userRepository.findByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const matches = await comparePassword(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
