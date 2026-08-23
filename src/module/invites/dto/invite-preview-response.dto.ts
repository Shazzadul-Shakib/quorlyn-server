import { ApiProperty } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';

export class InvitePreviewResponseDto {
  @ApiProperty()
  organizationName: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: OrgRole })
  role: OrgRole;

  @ApiProperty()
  isOrgOwner: boolean;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({
    description:
      'True when this email already has a Quorlyn account, so the client asks for the existing password instead of a new one.',
  })
  accountExists: boolean;
}
