import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class JoinOrganizationDto {
  @ApiProperty({
    example: 'K7M2PQ4R',
    description: 'Public organization join code',
  })
  @IsString()
  @Length(6, 12)
  joinCode: string;

  @ApiProperty({ example: 'student@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    minLength: 8,
    description:
      'Sets the password for a new account, or authenticates an existing one.',
  })
  @IsString()
  @MinLength(8)
  password: string;
}
