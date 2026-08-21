import { ApiProperty } from '@nestjs/swagger';
import { InviteStatus, Role } from '@prisma/client';

export class InviteResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ enum: InviteStatus })
  status: InviteStatus;

  @ApiProperty()
  isOrgOwner: boolean;

  @ApiProperty()
  expiresAt: Date;
}
