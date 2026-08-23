import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  MembershipStatus,
  OrgRole,
  Permission,
  PlatformRole,
} from '@prisma/client';
import { MembershipRepository } from '../repositories/membership.repository';
import { OrganizationRepository } from '../repositories/organization.repository';
import { OrgClaim } from './jwt-payload.interface';

const ALL_PERMISSIONS = Object.values(Permission);

/**
 * Turns "this user, that organization" into the claim embedded in an access
 * token (ADR-0007). Kept apart from TokenService so signing stays ignorant of
 * how membership is modelled.
 */
@Injectable()
export class OrgClaimService {
  constructor(
    private readonly membershipRepository: MembershipRepository,
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  /**
   * Throws if the user may not act in the organization. The superadmin may
   * select any organization and acts with owner-equivalent authority; they
   * hold no membership row, so the claim is synthesised.
   *
   * A suspended organization (Organization.isActive = false, ADR-0021)
   * blocks everyone from entering its claim — the superadmin included, so
   * flipping the switch can't be bypassed by the same actor who set it.
   * Un-suspending is unaffected: it operates on the organization id
   * directly and never goes through this claim.
   */
  async resolveOrThrow(
    userId: string,
    organizationId: string,
    platformRole: PlatformRole,
  ): Promise<OrgClaim> {
    const organization =
      await this.organizationRepository.findById(organizationId);
    if (!organization) {
      throw new ForbiddenException('Organization not found');
    }
    if (!organization.isActive) {
      throw new ForbiddenException(
        "This organization's platform access has been suspended",
      );
    }

    if (platformRole === PlatformRole.SUPERADMIN) {
      return {
        id: organization.id,
        role: OrgRole.TEACHER,
        isOrgOwner: true,
        permissions: ALL_PERMISSIONS,
      };
    }

    const membership = await this.membershipRepository.findByUserAndOrg(
      userId,
      organizationId,
    );
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(
        'You are not an active member of this organization',
      );
    }
    return this.toClaim(membership);
  }

  /** Non-throwing variant used when re-signing: a lost membership degrades to no claim. */
  async resolveOrNull(
    userId: string,
    organizationId: string,
    platformRole: PlatformRole,
  ): Promise<OrgClaim | null> {
    try {
      return await this.resolveOrThrow(userId, organizationId, platformRole);
    } catch {
      return null;
    }
  }

  /** The single membership to auto-select at login, if there is exactly one. */
  async resolveDefault(userId: string): Promise<OrgClaim | null> {
    const memberships =
      await this.membershipRepository.findManyByUserWithOrganization(userId);
    const active = memberships.filter(
      (membership) =>
        membership.status === MembershipStatus.ACTIVE &&
        membership.organization.isActive,
    );
    return active.length === 1 ? this.toClaim(active[0]) : null;
  }

  private toClaim(membership: {
    organizationId: string;
    role: OrgRole;
    isOrgOwner: boolean;
    permissions: Permission[];
  }): OrgClaim {
    return {
      id: membership.organizationId,
      role: membership.role,
      isOrgOwner: membership.isOrgOwner,
      permissions: membership.isOrgOwner
        ? ALL_PERMISSIONS
        : membership.permissions,
    };
  }
}
