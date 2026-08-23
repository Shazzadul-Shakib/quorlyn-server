import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListMembersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrgRole })
  @IsOptional()
  @IsEnum(OrgRole)
  role?: OrgRole;
}
