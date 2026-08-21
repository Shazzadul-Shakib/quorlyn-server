import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional } from 'class-validator';

/**
 * Deliberately decoupled from Prisma's Role enum: a client can never
 * request SUPERADMIN through this DTO, structurally.
 */
export enum InvitableRole {
  TEACHER = 'TEACHER',
  STUDENT = 'STUDENT',
}

export class CreateInviteDto {
  @ApiProperty({ example: 'colleague@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: InvitableRole })
  @IsEnum(InvitableRole)
  role: InvitableRole;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Grants org-owner privileges. Only meaningful for TEACHER invites.',
  })
  @IsOptional()
  @IsBoolean()
  isOrgOwner?: boolean;
}
