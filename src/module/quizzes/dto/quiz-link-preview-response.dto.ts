import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Language } from '@prisma/client';

/** Public: enough to decide whether to sign in. No questions, no ids that grant access. */
export class QuizLinkPreviewResponseDto {
  @ApiProperty() quizTitle: string;
  @ApiPropertyOptional({ type: String, nullable: true }) quizDescription:
    string | null;
  @ApiProperty() organizationName: string;
  @ApiProperty({ enum: Language }) language: Language;
  @ApiPropertyOptional({ type: String, nullable: true }) subject: string | null;
  @ApiProperty() durationSeconds: number;
  @ApiProperty() questionCount: number;
  @ApiProperty() totalPoints: number;
  @ApiPropertyOptional({ type: Date, nullable: true }) opensAt: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) closesAt: Date | null;
  @ApiProperty() maxAttempts: number;
  @ApiProperty({
    description:
      'False when revoked, expired, exhausted, or the quiz is closed',
  })
  acceptingAttempts: boolean;
}
