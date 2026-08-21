import { User } from '@prisma/client';
import { UserSummaryDto } from '../dto/user-summary.dto';

export function toUserSummary(user: User): UserSummaryDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    isOrgOwner: user.isOrgOwner,
  };
}
