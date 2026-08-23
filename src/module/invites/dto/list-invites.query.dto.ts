import { ApiPropertyOptional } from '@nestjs/swagger';
import { InviteStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListInvitesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InviteStatus })
  @IsOptional()
  @IsEnum(InviteStatus)
  status?: InviteStatus;
}
