import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class UserSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ nullable: true, type: String })
  organizationId: string | null;

  @ApiProperty()
  isOrgOwner: boolean;
}
