import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrgRole, Permission } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
} from 'class-validator';

export const MAX_BATCH_INVITES = 100;

export class CreateInviteBatchDto {
  @ApiProperty({
    type: [String],
    maxItems: MAX_BATCH_INVITES,
    example: ['teacher1@school.edu', 'teacher2@school.edu'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_INVITES)
  @IsEmail({}, { each: true })
  emails: string[];

  @ApiProperty({ enum: OrgRole })
  @IsEnum(OrgRole)
  role: OrgRole;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOrgOwner?: boolean;

  @ApiPropertyOptional({ enum: Permission, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];
}
