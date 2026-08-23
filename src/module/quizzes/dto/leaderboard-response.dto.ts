import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScoringPolicy } from '@prisma/client';

export class LeaderboardEntryDto {
  @ApiProperty() rank: number;
  @ApiProperty() userId: string;
  @ApiProperty() email: string;
  @ApiProperty() attemptId: string;
  @ApiProperty() score: number;
  @ApiProperty() maxScore: number;
  @ApiProperty({ description: 'Tie-breaker: faster wins' }) durationMs: number;
  @ApiProperty() submittedAt: Date;
}

export class LeaderboardResponseDto {
  @ApiProperty() quizId: string;
  @ApiProperty({ enum: ScoringPolicy }) scoringPolicy: ScoringPolicy;
  @ApiProperty({ type: [LeaderboardEntryDto] }) entries: LeaderboardEntryDto[];

  @ApiPropertyOptional({
    type: LeaderboardEntryDto,
    nullable: true,
    description:
      "The caller's own row, included even when outside the returned page",
  })
  me: LeaderboardEntryDto | null;
}
