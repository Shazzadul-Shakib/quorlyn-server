import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Dhaka Model School' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({
    example: 'principal@school.edu',
    description: 'Receives an owner invite for the new organization',
  })
  @IsEmail()
  ownerEmail: string;
}
