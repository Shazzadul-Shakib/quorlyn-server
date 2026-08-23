import { QuestionType } from '@prisma/client';
import { QuestionWithAnswerKey } from '../../repositories/question.repository';

export const QUESTION_GRADER = Symbol('QUESTION_GRADER');

/**
 * One grader per question type. Adding a type means adding a class and
 * registering it — no existing grader and no `switch` changes (OCP).
 */
export interface QuestionGrader {
  readonly type: QuestionType;

  /** Points awarded for this answer: 0, or the question's full points. */
  grade(question: QuestionWithAnswerKey, selectedOptionIds: string[]): number;
}
