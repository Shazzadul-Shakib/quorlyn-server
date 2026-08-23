import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrgRole, Permission } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
} from 'class-validator';

export class CreateInviteDto {
  @ApiProperty({ example: 'colleague@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    enum: OrgRole,
    description:
      'OrgRole has no superadmin value, so privilege escalation is structurally impossible here (ADR-0006).',
  })
  @IsEnum(OrgRole)
  role: OrgRole;

  @ApiPropertyOptional({
    default: false,
    description:
      'Grants org-owner authority. Only meaningful for TEACHER invites.',
  })
  @IsOptional()
  @IsBoolean()
  isOrgOwner?: boolean;

  @ApiPropertyOptional({
    enum: Permission,
    isArray: true,
    description:
      'Defaults to MANAGE_QUIZZES + VIEW_RESULTS for teachers; ignored for students.',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];
}
