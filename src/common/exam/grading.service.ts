import { Inject, Injectable } from '@nestjs/common';
import { AttemptAnswer, QuestionType } from '@prisma/client';
import { QuestionWithAnswerKey } from '../repositories/question.repository';
import { QUESTION_GRADER, QuestionGrader } from './graders/question-grader';

export interface GradedAttempt {
  score: number;
  maxScore: number;
  grades: { id: string; isCorrect: boolean; pointsAwarded: number }[];
}

/**
 * Grades a whole attempt in one pass at finalization (ADR-0014). It reads the
 * answer key directly and never returns it, so correctness never travels
 * through a DTO that a student could receive (ADR-0011).
 */
@Injectable()
export class GradingService {
  private readonly byType: Map<QuestionType, QuestionGrader>;

  constructor(@Inject(QUESTION_GRADER) graders: QuestionGrader[]) {
    this.byType = new Map(graders.map((grader) => [grader.type, grader]));
  }

  grade(
    questions: QuestionWithAnswerKey[],
    answers: AttemptAnswer[],
  ): GradedAttempt {
    const answerByQuestion = new Map(
      answers.map((answer) => [answer.questionId, answer]),
    );

    let score = 0;
    let maxScore = 0;
    const grades: GradedAttempt['grades'] = [];

    for (const question of questions) {
      maxScore += question.points;
      const answer = answerByQuestion.get(question.id);
      if (!answer) {
        continue; // unanswered: no row to grade, no points
      }

      const grader = this.byType.get(question.type);
      const pointsAwarded = grader
        ? grader.grade(question, answer.selectedOptionIds)
        : 0;

      score += pointsAwarded;
      grades.push({
        id: answer.id,
        isCorrect: pointsAwarded > 0,
        pointsAwarded,
      });
    }

    return { score, maxScore, grades };
  }
}
