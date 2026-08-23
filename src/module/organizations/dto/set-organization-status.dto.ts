import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetOrganizationStatusDto {
  @ApiProperty({
    description:
      'False suspends every member of this organization from acting in it.',
  })
  @IsBoolean()
  isActive: boolean;
}
