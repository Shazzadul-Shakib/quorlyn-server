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
   */
  async resolveOrThrow(
    userId: string,
    organizationId: string,
    platformRole: PlatformRole,
  ): Promise<OrgClaim> {
    if (platformRole === PlatformRole.SUPERADMIN) {
      const organization =
        await this.organizationRepository.findById(organizationId);
      if (!organization) {
        throw new ForbiddenException('Organization not found');
      }
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
      (membership) => membership.status === MembershipStatus.ACTIVE,
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
