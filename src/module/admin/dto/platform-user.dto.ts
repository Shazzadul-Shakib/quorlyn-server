import { ApiProperty } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';

export class PlatformUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: PlatformRole })
  platformRole: PlatformRole;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  singleDeviceEnforced: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: 'Number of organizations this user belongs to' })
  membershipCount: number;
}
