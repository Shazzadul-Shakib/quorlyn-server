import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive substring match against email',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
