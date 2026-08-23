import { ApiProperty } from '@nestjs/swagger';

export class OrganizationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Public self-serve student join code' })
  joinCode: string;

  @ApiProperty()
  createdAt: Date;
}
