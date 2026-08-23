import { Injectable } from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import { QuestionWithAnswerKey } from '../../repositories/question.repository';
import { QuestionGrader } from './question-grader';

/**
 * Exactly one selection, and it must be the correct option. Shared by
 * single-choice and true/false, which differ only in how they are authored.
 */
abstract class SingleSelectionGrader implements QuestionGrader {
  abstract readonly type: QuestionType;

  grade(question: QuestionWithAnswerKey, selectedOptionIds: string[]): number {
    if (selectedOptionIds.length !== 1) {
      return 0;
    }
    const selected = question.options.find(
      (option) => option.id === selectedOptionIds[0],
    );
    return selected?.isCorrect ? question.points : 0;
  }
}

@Injectable()
export class SingleChoiceGrader extends SingleSelectionGrader {
  readonly type = QuestionType.SINGLE_CHOICE;
}

@Injectable()
export class TrueFalseGrader extends SingleSelectionGrader {
  readonly type = QuestionType.TRUE_FALSE;
}
