import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Language, ScoringPolicy } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateQuizDto {
  @ApiProperty({ example: 'পদার্থবিজ্ঞান — অধ্যায় ৩' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: Language, default: Language.MIXED })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ example: 'Physics' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  subject?: string;

  @ApiProperty({
    example: 1800,
    description: 'Length of one sitting, in seconds',
  })
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(6 * 60 * 60)
  durationSeconds: number;

  @ApiPropertyOptional({
    description: 'ISO-8601 UTC. Null means open once published.',
  })
  @IsOptional()
  @IsDateString()
  opensAt?: string;

  @ApiPropertyOptional({
    description: 'ISO-8601 UTC. Truncates a sitting that runs past it.',
  })
  @IsOptional()
  @IsDateString()
  closesAt?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @ApiPropertyOptional({ enum: ScoringPolicy, default: ScoringPolicy.BEST })
  @IsOptional()
  @IsEnum(ScoringPolicy)
  scoringPolicy?: ScoringPolicy;

  @ApiPropertyOptional({
    default: true,
    description: 'Refuse a start that would get less than the full duration.',
  })
  @IsOptional()
  @IsBoolean()
  lateStartCutoff?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  shuffleQuestions?: boolean;

  @ApiPropertyOptional({
    default: 3,
    description: 'Focus violations before auto-submission. Null records only.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxFocusViolations?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  leaderboardVisibleToStudents?: boolean;
}
