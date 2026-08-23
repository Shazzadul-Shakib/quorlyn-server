import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProctorEventType } from '@prisma/client';
import { AttemptResponseDto } from './attempt-response.dto';

export class ProctorEventDto {
  @ApiProperty({ enum: ProctorEventType }) type: ProctorEventType;
  @ApiProperty() occurredAt: Date;
}

export class GradedAnswerDto {
  @ApiProperty() questionId: string;
  @ApiProperty({ type: [String] }) selectedOptionIds: string[];
  @ApiPropertyOptional({ type: Boolean, nullable: true }) isCorrect:
    boolean | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) pointsAwarded:
    number | null;
}

/** Teacher-facing: correctness per answer, plus the proctoring timeline. */
export class AttemptDetailResponseDto {
  @ApiProperty({ type: AttemptResponseDto }) attempt: AttemptResponseDto;
  @ApiProperty() studentEmail: string;
  @ApiProperty({ type: [GradedAnswerDto] }) answers: GradedAnswerDto[];
  @ApiProperty({ type: [ProctorEventDto] }) events: ProctorEventDto[];
}
