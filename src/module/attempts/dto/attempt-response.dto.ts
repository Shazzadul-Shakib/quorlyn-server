import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttemptStatus, SubmissionCause } from '@prisma/client';

export class AttemptResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() quizId: string;
  @ApiProperty() quizTitle: string;
  @ApiProperty() attemptNumber: number;
  @ApiProperty({ enum: AttemptStatus }) status: AttemptStatus;
  @ApiProperty() startedAt: Date;

  @ApiProperty({
    description:
      'Server-computed end of this sitting. The client renders a countdown from it; it is never negotiated (ADR-0014).',
  })
  deadlineAt: Date;

  @ApiProperty({
    description:
      'Server clock at the moment of this response — use it to correct for client clock skew',
  })
  serverTime: Date;

  @ApiProperty({ description: 'Milliseconds left, from the server clock' })
  remainingMs: number;

  @ApiPropertyOptional({ type: Date, nullable: true }) submittedAt: Date | null;

  @ApiPropertyOptional({
    enum: SubmissionCause,
    nullable: true,
    description: 'Always set once submitted, including MANUAL (ADR-0015)',
  })
  submissionCause: SubmissionCause | null;

  @ApiPropertyOptional({ type: Number, nullable: true }) score: number | null;
  @ApiProperty() maxScore: number;
  @ApiProperty() focusViolations: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxFocusViolations:
    number | null;
}
