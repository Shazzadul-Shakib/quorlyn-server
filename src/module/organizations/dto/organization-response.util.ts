import { Organization } from '@prisma/client';
import { OrganizationResponseDto } from './organization-response.dto';

export function toOrganizationResponse(
  organization: Organization,
): OrganizationResponseDto {
  return {
    id: organization.id,
    name: organization.name,
    joinCode: organization.joinCode,
    isActive: organization.isActive,
    createdAt: organization.createdAt,
  };
}
