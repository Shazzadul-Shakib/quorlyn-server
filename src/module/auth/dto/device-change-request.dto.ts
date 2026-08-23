import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class DeviceChangeRequestDto {
  @ApiProperty({ example: 'student@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Re-verified so a code cannot be triggered by email alone',
  })
  @IsString()
  @MinLength(8)
  password: string;
}
