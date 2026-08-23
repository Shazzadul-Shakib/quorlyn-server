import { ApiProperty } from '@nestjs/swagger';
import { InviteStatus, OrgRole, Permission } from '@prisma/client';

export class InviteResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: OrgRole })
  role: OrgRole;

  @ApiProperty({ enum: InviteStatus })
  status: InviteStatus;

  @ApiProperty()
  isOrgOwner: boolean;

  @ApiProperty({ enum: Permission, isArray: true })
  permissions: Permission[];

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;
}
