import { Injectable } from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import { QuestionWithAnswerKey } from '../../repositories/question.repository';
import { QuestionGrader } from './question-grader';

/**
 * All-or-nothing: the selected set must equal the correct set. Partial credit
 * would let "select everything" outscore a correct answer (ADR-0014).
 */
@Injectable()
export class MultiChoiceGrader implements QuestionGrader {
  readonly type = QuestionType.MULTI_CHOICE;

  grade(question: QuestionWithAnswerKey, selectedOptionIds: string[]): number {
    const correct = new Set(
      question.options
        .filter((option) => option.isCorrect)
        .map((option) => option.id),
    );
    const validSelections = new Set(
      selectedOptionIds.filter((id) =>
        question.options.some((option) => option.id === id),
      ),
    );

    if (validSelections.size !== correct.size) {
      return 0;
    }
    for (const id of validSelections) {
      if (!correct.has(id)) {
        return 0;
      }
    }
    return question.points;
  }
}
