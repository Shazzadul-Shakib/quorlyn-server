import { ApiProperty } from '@nestjs/swagger';
import { ProctorEventType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsDateString,
  ValidateNested,
} from 'class-validator';

export class ProctorEventInputDto {
  @ApiProperty({ enum: ProctorEventType })
  @IsEnum(ProctorEventType)
  type: ProctorEventType;

  @ApiProperty({
    required: false,
    description:
      'Client timestamp, kept for diagnostics only — the server stamps its own time (ADR-0016).',
  })
  @IsOptional()
  @IsDateString()
  clientTime?: string;
}

export class ReportEventsDto {
  @ApiProperty({ type: [ProctorEventInputDto], maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProctorEventInputDto)
  events: ProctorEventInputDto[];
}
