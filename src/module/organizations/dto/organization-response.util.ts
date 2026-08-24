import { Organization } from '@prisma/client';
import { OrganizationResponseDto } from './organization-response.dto';

export function toOrganizationResponse(
  organization: Organization,
  counts: { teacherCount: number; studentCount: number },
): OrganizationResponseDto {
  return {
    id: organization.id,
    name: organization.name,
    joinCode: organization.joinCode,
    isActive: organization.isActive,
    createdAt: organization.createdAt,
    teacherCount: counts.teacherCount,
    studentCount: counts.studentCount,
  };
}
