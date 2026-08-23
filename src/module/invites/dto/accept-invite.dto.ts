import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({
    description:
      'Sets the password for a new account, or authenticates an existing one with this email.',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password: string;
}
