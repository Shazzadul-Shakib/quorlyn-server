import {
  ExamQuestion,
  QuestionWithAnswerKey,
} from '../../../common/repositories/question.repository';
import { AnswerKeyQuestionDto, ExamQuestionDto } from './question-response.dto';

export function toAnswerKeyQuestion(
  question: QuestionWithAnswerKey,
): AnswerKeyQuestionDto {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    contentFormat: question.contentFormat,
    points: question.points,
    position: question.position,
    options: question.options.map((option) => ({
      id: option.id,
      text: option.text,
      isCorrect: option.isCorrect,
      position: option.position,
    })),
  };
}

/**
 * Deliberately a separate mapper from the answer-key one. A shared mapper
 * with an `includeAnswers` flag is how the key leaks (ADR-0011).
 */
export function toExamQuestion(question: ExamQuestion): ExamQuestionDto {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    contentFormat: question.contentFormat,
    points: question.points,
    options: question.options.map((option) => ({
      id: option.id,
      text: option.text,
    })),
  };
}
