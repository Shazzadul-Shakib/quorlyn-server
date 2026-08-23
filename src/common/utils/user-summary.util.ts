import { User } from '@prisma/client';
import { UserSummaryDto } from '../dto/user-summary.dto';
import { MembershipSummaryDto } from '../dto/membership-summary.dto';
import { MembershipWithOrganization } from '../repositories/membership.repository';

export function toUserSummary(user: User): UserSummaryDto {
  return {
    id: user.id,
    email: user.email,
    platformRole: user.platformRole,
    singleDeviceEnforced: user.singleDeviceEnforced,
  };
}

export function toMembershipSummary(
  membership: MembershipWithOrganization,
): MembershipSummaryDto {
  return {
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role,
    isOrgOwner: membership.isOrgOwner,
    status: membership.status,
    permissions: membership.permissions,
  };
}
