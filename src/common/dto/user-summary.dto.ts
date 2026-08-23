import { ApiProperty } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';

export class UserSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: PlatformRole })
  platformRole: PlatformRole;

  @ApiProperty({
    description: 'Whether this account may hold only one active session',
  })
  singleDeviceEnforced: boolean;
}
