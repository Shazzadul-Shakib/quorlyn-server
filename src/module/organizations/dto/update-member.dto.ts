import { ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus, Permission } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: Permission, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];

  @ApiPropertyOptional({
    description: 'Owners implicitly hold every permission (ADR-0008)',
  })
  @IsOptional()
  @IsBoolean()
  isOrgOwner?: boolean;

  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
