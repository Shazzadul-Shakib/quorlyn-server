import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class InvitePreviewResponseDto {
  @ApiProperty()
  organizationName: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  isOrgOwner: boolean;

  @ApiProperty()
  expiresAt: Date;
}
