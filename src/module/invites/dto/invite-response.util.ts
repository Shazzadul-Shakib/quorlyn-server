import { Invite } from '@prisma/client';
import { InviteResponseDto } from './invite-response.dto';

export function toInviteResponse(invite: Invite): InviteResponseDto {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    isOrgOwner: invite.isOrgOwner,
    expiresAt: invite.expiresAt,
  };
}
