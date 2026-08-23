import { Injectable } from '@nestjs/common';
import { AttemptAnswer, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface GradedAnswer {
  id: string;
  isCorrect: boolean;
  pointsAwarded: number;
}

@Injectable()
export class AttemptAnswerRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(
    attemptId: string,
    questionId: string,
    selectedOptionIds: string[],
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AttemptAnswer> {
    return tx.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: { attemptId, questionId, selectedOptionIds },
      update: { selectedOptionIds },
    });
  }

  findManyByAttempt(
    attemptId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AttemptAnswer[]> {
    return tx.attemptAnswer.findMany({ where: { attemptId } });
  }

  async applyGrades(
    grades: GradedAnswer[],
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    for (const grade of grades) {
      await tx.attemptAnswer.update({
        where: { id: grade.id },
        data: {
          isCorrect: grade.isCorrect,
          pointsAwarded: grade.pointsAwarded,
        },
      });
    }
  }

  /** Per-question difficulty for the teacher dashboard (ADR-0019). */
  async difficultyByQuiz(
    quizId: string,
  ): Promise<{ questionId: string; answered: number; correct: number }[]> {
    const rows = await this.prisma.attemptAnswer.groupBy({
      by: ['questionId', 'isCorrect'],
      where: { attempt: { quizId, status: 'SUBMITTED' } },
      _count: { _all: true },
    });

    const byQuestion = new Map<string, { answered: number; correct: number }>();
    for (const row of rows) {
      const entry = byQuestion.get(row.questionId) ?? {
        answered: 0,
        correct: 0,
      };
      entry.answered += row._count._all;
      if (row.isCorrect === true) {
        entry.correct += row._count._all;
      }
      byQuestion.set(row.questionId, entry);
    }
    return [...byQuestion.entries()].map(([questionId, counts]) => ({
      questionId,
      ...counts,
    }));
  }
}
