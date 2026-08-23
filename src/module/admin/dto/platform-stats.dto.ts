import { ApiProperty } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';

export class MembershipRoleCountDto {
  @ApiProperty({ enum: OrgRole })
  role: OrgRole;

  @ApiProperty()
  count: number;
}

export class PlatformStatsDto {
  @ApiProperty()
  organizationsTotal: number;

  @ApiProperty()
  organizationsActive: number;

  @ApiProperty()
  organizationsSuspended: number;

  @ApiProperty()
  usersTotal: number;

  @ApiProperty({ type: [MembershipRoleCountDto] })
  membershipsByRole: MembershipRoleCountDto[];
}
