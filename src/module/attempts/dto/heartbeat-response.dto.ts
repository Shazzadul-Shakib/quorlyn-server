import { ApiProperty } from '@nestjs/swagger';
import { AttemptStatus, SubmissionCause } from '@prisma/client';

export class HeartbeatResponseDto {
  @ApiProperty({ enum: AttemptStatus }) status: AttemptStatus;
  @ApiProperty() serverTime: Date;
  @ApiProperty() deadlineAt: Date;
  @ApiProperty() remainingMs: number;

  @ApiProperty({
    required: false,
    nullable: true,
    enum: SubmissionCause,
    description: 'Set when this heartbeat found the attempt already finished',
  })
  submissionCause: SubmissionCause | null;
}
