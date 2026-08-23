import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { MembershipRepository } from '../repositories/membership.repository';
import { OrgClaimService } from '../token/org-claim.service';
import { RefreshTokenMeta, TokenService } from '../token/token.service';
import { AuthTokensResponseDto } from '../dto/auth-tokens-response.dto';
import { toMembershipSummary, toUserSummary } from '../utils/user-summary.util';
import { DeviceSessionService } from './device-session.service';

export interface StartSessionContext extends RefreshTokenMeta {
  deviceId: string | null;
  /** Pre-select this organization instead of the default single membership. */
  preferredOrganizationId?: string;
}

/**
 * The one place a signed-in session is created. Login, invite acceptance and
 * join-code signup all land here, so device binding (ADR-0017) and
 * organization pre-selection (ADR-0007) cannot drift between them.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly membershipRepository: MembershipRepository,
    private readonly orgClaimService: OrgClaimService,
    private readonly tokenService: TokenService,
    private readonly deviceSessionService: DeviceSessionService,
  ) {}

  async start(
    user: User,
    context: StartSessionContext,
  ): Promise<AuthTokensResponseDto> {
    const deviceId = await this.deviceSessionService.resolveForLogin(
      user,
      context.deviceId,
      context.userAgent,
    );
    return this.startWithDevice(user, deviceId, context);
  }

  /** Used when the device has already been resolved (e.g. after verification). */
  async startWithDevice(
    user: User,
    deviceId: string | null,
    context: StartSessionContext,
  ): Promise<AuthTokensResponseDto> {
    const memberships =
      await this.membershipRepository.findManyByUserWithOrganization(user.id);

    const org = context.preferredOrganizationId
      ? await this.orgClaimService.resolveOrNull(
          user.id,
          context.preferredOrganizationId,
          user.platformRole,
        )
      : await this.orgClaimService.resolveDefault(user.id);

    const tokens = await this.tokenService.issueTokenPair(user, {
      org,
      deviceId,
      meta: { userAgent: context.userAgent, ipAddress: context.ipAddress },
    });

    return {
      ...tokens,
      user: toUserSummary(user),
      memberships: memberships.map(toMembershipSummary),
      org,
    };
  }
}
