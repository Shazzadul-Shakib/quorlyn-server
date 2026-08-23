import { ApiPropertyOptional } from '@nestjs/swagger';
import { QuizStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListQuizzesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: QuizStatus })
  @IsOptional()
  @IsEnum(QuizStatus)
  status?: QuizStatus;

  @ApiPropertyOptional({ description: 'Only quizzes the caller authored' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;
}
