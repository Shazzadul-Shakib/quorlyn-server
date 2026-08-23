import { ApiProperty } from '@nestjs/swagger';
import { MembershipStatus, OrgRole, Permission } from '@prisma/client';

export class MembershipSummaryDto {
  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  organizationName: string;

  @ApiProperty({
    description:
      "False if the organization's own platform access is suspended (superadmin-controlled), independent of this membership's own status.",
  })
  organizationIsActive: boolean;

  @ApiProperty({ enum: OrgRole })
  role: OrgRole;

  @ApiProperty()
  isOrgOwner: boolean;

  @ApiProperty({ enum: MembershipStatus })
  status: MembershipStatus;

  @ApiProperty({ enum: Permission, isArray: true })
  permissions: Permission[];
}
