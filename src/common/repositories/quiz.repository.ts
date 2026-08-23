import { Injectable } from '@nestjs/common';
import {
  Language,
  Prisma,
  Quiz,
  QuizStatus,
  ScoringPolicy,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateQuizInput {
  organizationId: string;
  createdById: string;
  title: string;
  description?: string;
  language?: Language;
  subject?: string;
  durationSeconds: number;
  opensAt?: Date | null;
  closesAt?: Date | null;
  maxAttempts?: number;
  scoringPolicy?: ScoringPolicy;
  lateStartCutoff?: boolean;
  shuffleQuestions?: boolean;
  maxFocusViolations?: number | null;
  leaderboardVisibleToStudents?: boolean;
}

export type UpdateQuizInput = Partial<
  Omit<CreateQuizInput, 'organizationId' | 'createdById'>
>;

export interface ListQuizzesFilter {
  organizationId: string;
  status?: QuizStatus;
  createdById?: string;
  take?: number;
  skip?: number;
}

@Injectable()
export class QuizRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: CreateQuizInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Quiz> {
    return tx.quiz.create({ data });
  }

  findById(id: string): Promise<Quiz | null> {
    return this.prisma.quiz.findUnique({ where: { id } });
  }

  findByIdInOrg(id: string, organizationId: string): Promise<Quiz | null> {
    return this.prisma.quiz.findFirst({ where: { id, organizationId } });
  }

  findMany(filter: ListQuizzesFilter): Promise<Quiz[]> {
    return this.prisma.quiz.findMany({
      where: this.toWhere(filter),
      orderBy: { createdAt: 'desc' },
      take: filter.take ?? 50,
      skip: filter.skip ?? 0,
    });
  }

  count(filter: ListQuizzesFilter): Promise<number> {
    return this.prisma.quiz.count({ where: this.toWhere(filter) });
  }

  update(
    id: string,
    data: UpdateQuizInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Quiz> {
    return tx.quiz.update({ where: { id }, data });
  }

  /**
   * Status transitions are conditional updates so two concurrent callers
   * cannot both "publish" (ADR-0010). Returns null when the quiz was no
   * longer in the expected status.
   */
  async transitionStatus(
    id: string,
    from: QuizStatus[],
    to: QuizStatus,
    stamps: { publishedAt?: Date; closedAt?: Date } = {},
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Quiz | null> {
    const { count } = await tx.quiz.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, ...stamps },
    });
    if (count === 0) {
      return null;
    }
    return tx.quiz.findUnique({ where: { id } });
  }

  async recalculateTotalPoints(
    quizId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const aggregate = await tx.question.aggregate({
      where: { quizId },
      _sum: { points: true },
    });
    const totalPoints = aggregate._sum.points ?? 0;
    await tx.quiz.update({ where: { id: quizId }, data: { totalPoints } });
    return totalPoints;
  }

  async deleteDraft(id: string): Promise<boolean> {
    const { count } = await this.prisma.quiz.deleteMany({
      where: { id, status: QuizStatus.DRAFT },
    });
    return count === 1;
  }

  private toWhere(filter: ListQuizzesFilter): Prisma.QuizWhereInput {
    return {
      organizationId: filter.organizationId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.createdById ? { createdById: filter.createdById } : {}),
    };
  }
}
