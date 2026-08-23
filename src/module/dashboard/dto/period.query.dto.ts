import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export const DEFAULT_PERIOD_DAYS = 90;

/** Every dashboard query is bounded to one organization and one window (ADR-0019). */
export class PeriodQueryDto {
  @ApiPropertyOptional({ description: 'ISO-8601 UTC; defaults to 90 days ago' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 UTC; defaults to now' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
