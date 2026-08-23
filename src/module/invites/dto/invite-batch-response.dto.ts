import { ApiProperty } from '@nestjs/swagger';

export enum BatchInviteOutcome {
  INVITED = 'INVITED',
  ALREADY_MEMBER = 'ALREADY_MEMBER',
  ALREADY_INVITED = 'ALREADY_INVITED',
}

export class BatchInviteResultDto {
  @ApiProperty()
  email: string;

  @ApiProperty({ enum: BatchInviteOutcome })
  status: BatchInviteOutcome;

  @ApiProperty({ required: false, nullable: true, type: String })
  inviteId: string | null;
}

/**
 * A 201 that reports per-recipient failures: re-inviting a mostly-onboarded
 * group is the normal case, so one conflict must not fail the batch
 * (ADR-0009). Clients that only check the status code will miss these.
 */
export class BatchInviteResponseDto {
  @ApiProperty()
  created: number;

  @ApiProperty()
  skipped: number;

  @ApiProperty({ type: [BatchInviteResultDto] })
  results: BatchInviteResultDto[];
}
