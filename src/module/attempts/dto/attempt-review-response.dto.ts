import { ApiProperty } from '@nestjs/swagger';
import { AttemptResponseDto } from './attempt-response.dto';
import { GradedAnswerDto } from './attempt-detail-response.dto';
import { AnswerKeyQuestionDto } from '../../quizzes/dto/question-response.dto';

/**
 * Student-facing, but carrying the answer key — the one deliberate exception
 * to ADR-0011's "students never receive isCorrect." Gated by *time*
 * (`AttemptsService.reviewOwnAttempt`: the quiz must be closed, archived, or
 * past its `closesAt`) rather than by role, since the caller is always the
 * attempt's own owner. A distinct DTO from both `ExamStateResponseDto`
 * (no answer key, ever) and `AttemptDetailResponseDto` (answer key, but
 * `VIEW_RESULTS`-gated for a teacher viewing someone else's attempt) — per
 * ADR-0011 §1/§2/§4, this is a separate DTO/route/repository-read pair, not
 * a role or time branch grafted onto either existing one.
 */
export class AttemptReviewResponseDto {
  @ApiProperty({ type: AttemptResponseDto }) attempt: AttemptResponseDto;
  @ApiProperty({ type: [AnswerKeyQuestionDto] })
  questions: AnswerKeyQuestionDto[];
  @ApiProperty({ type: [GradedAnswerDto] }) answers: GradedAnswerDto[];
}
