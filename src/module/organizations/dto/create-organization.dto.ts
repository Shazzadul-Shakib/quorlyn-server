import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme School' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    example: 'owner@acmeschool.example',
    description: "Email of the org's first teacher (owner)",
  })
  @IsEmail()
  ownerEmail: string;
}
