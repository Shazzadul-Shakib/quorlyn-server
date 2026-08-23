import { MembershipWithUser } from '../../../common/repositories/membership.repository';
import { MemberResponseDto } from './member-response.dto';

export function toMemberResponse(
  membership: MembershipWithUser,
): MemberResponseDto {
  return {
    id: membership.id,
    userId: membership.userId,
    email: membership.user.email,
    role: membership.role,
    isOrgOwner: membership.isOrgOwner,
    status: membership.status,
    permissions: membership.permissions,
    joinedAt: membership.joinedAt,
  };
}
