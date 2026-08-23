import { ApiProperty } from '@nestjs/swagger';
import { AttemptResponseDto } from './attempt-response.dto';
import { ExamQuestionDto } from '../../quizzes/dto/question-response.dto';

export class SavedAnswerDto {
  @ApiProperty() questionId: string;
  @ApiProperty({ type: [String] }) selectedOptionIds: string[];
}

export class ExamStateResponseDto {
  @ApiProperty({ type: AttemptResponseDto }) attempt: AttemptResponseDto;

  @ApiProperty({
    type: [ExamQuestionDto],
    description:
      'Shuffled deterministically from the attempt id, so a reconnecting student sees the same order.',
  })
  questions: ExamQuestionDto[];

  @ApiProperty({ type: [SavedAnswerDto] }) answers: SavedAnswerDto[];
}
