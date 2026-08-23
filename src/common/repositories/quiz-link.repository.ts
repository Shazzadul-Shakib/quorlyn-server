import { Injectable } from '@nestjs/common';
import { Prisma, Quiz, QuizLink } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateQuizLinkInput {
  quizId: string;
  tokenHash: string;
  createdById: string;
  label?: string;
  expiresAt?: Date | null;
  maxUses?: number | null;
}

export type QuizLinkWithQuiz = QuizLink & { quiz: Quiz };

@Injectable()
export class QuizLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateQuizLinkInput): Promise<QuizLink> {
    return this.prisma.quizLink.create({ data });
  }

  findByTokenHashWithQuiz(tokenHash: string): Promise<QuizLinkWithQuiz | null> {
    return this.prisma.quizLink.findUnique({
      where: { tokenHash },
      include: { quiz: true },
    });
  }

  findManyByQuiz(quizId: string): Promise<QuizLink[]> {
    return this.prisma.quizLink.findMany({
      where: { quizId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByIdInQuiz(id: string, quizId: string): Promise<QuizLink | null> {
    return this.prisma.quizLink.findFirst({ where: { id, quizId } });
  }

  async revoke(id: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.quizLink.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
    return count === 1;
  }

  /**
   * Conditional increment: two simultaneous first-time starts on a
   * `maxUses = 1` link cannot both succeed (ADR-0013).
   */
  async tryConsumeUse(
    id: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const affected = await tx.$executeRaw`
      UPDATE "QuizLink"
      SET "usedCount" = "usedCount" + 1
      WHERE "id" = ${id}
        AND "revokedAt" IS NULL
        AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
    `;
    return affected === 1;
  }
}
