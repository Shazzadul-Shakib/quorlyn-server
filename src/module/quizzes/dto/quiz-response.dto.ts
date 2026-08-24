import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Language, QuizStatus, ScoringPolicy } from '@prisma/client';

export class QuizResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() organizationId: string;
  @ApiProperty() createdById: string;
  @ApiProperty() createdByEmail: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description:
    string | null;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiPropertyOptional({ type: String, nullable: true }) subject: string | null;
  @ApiProperty({ enum: QuizStatus }) status: QuizStatus;
  @ApiProperty() durationSeconds: number;
  @ApiPropertyOptional({ type: Date, nullable: true }) opensAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) closesAt: Date | null;
  @ApiProperty() maxAttempts: number;
  @ApiProperty({ enum: ScoringPolicy }) scoringPolicy: ScoringPolicy;
  @ApiProperty() lateStartCutoff: boolean;
  @ApiProperty() shuffleQuestions: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxFocusViolations:
    number | null;
  @ApiProperty() leaderboardVisibleToStudents: boolean;
  @ApiProperty() totalPoints: number;
  @ApiProperty() questionCount: number;
  @ApiPropertyOptional({ type: Date, nullable: true }) publishedAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) closedAt: Date | null;
  @ApiProperty() createdAt: Date;
}
