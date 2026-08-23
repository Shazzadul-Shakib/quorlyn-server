import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentFormat, QuestionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_CONTENT_LENGTH } from '../../../common/content/content.util';

export class QuestionOptionDto {
  @ApiProperty({
    example: '$\\ce{2H2 + O2 -> 2H2O}$',
    description: 'UTF-8 text with inline LaTeX between $…$ or $$…$$ (ADR-0020)',
  })
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  text: string;

  @ApiProperty({ description: 'Never serialized to a student (ADR-0011)' })
  @IsBoolean()
  isCorrect: boolean;
}

export class CreateQuestionDto {
  @ApiProperty({ enum: QuestionType })
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiProperty({
    example: 'একটি বস্তুর ভরবেগ $p = mv$ হলে গতিশক্তি কত?',
    description: 'Mixed Bangla/English prose with inline LaTeX',
  })
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  prompt: string;

  @ApiPropertyOptional({
    enum: ContentFormat,
    default: ContentFormat.LATEX_MIXED,
  })
  @IsOptional()
  @IsEnum(ContentFormat)
  contentFormat?: ContentFormat;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  points?: number;

  @ApiProperty({ type: [QuestionOptionDto], minItems: 2, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options: QuestionOptionDto[];
}
