import { ApiProperty } from '@nestjs/swagger';
import { MembershipStatus, OrgRole, Permission } from '@prisma/client';

export class MemberResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: OrgRole })
  role: OrgRole;

  @ApiProperty()
  isOrgOwner: boolean;

  @ApiProperty({ enum: MembershipStatus })
  status: MembershipStatus;

  @ApiProperty({ enum: Permission, isArray: true })
  permissions: Permission[];

  @ApiProperty()
  joinedAt: Date;
}
