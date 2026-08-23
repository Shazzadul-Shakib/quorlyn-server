import { ApiProperty } from '@nestjs/swagger';
import { OrgRole, Permission } from '@prisma/client';

/** The organization claim carried by the access token (ADR-0007). */
export class OrgContextDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: OrgRole })
  role: OrgRole;

  @ApiProperty()
  isOrgOwner: boolean;

  @ApiProperty({ enum: Permission, isArray: true })
  permissions: Permission[];
}
