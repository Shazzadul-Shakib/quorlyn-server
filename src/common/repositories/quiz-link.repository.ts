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

  /**
   * A hard delete, not a soft-revoke: the row is gone, not flagged. Safe to
   * do even for a link that already has attempts against it — `Attempt.
   * quizLinkId` is `onDelete: SetNull`, so those attempts just lose the
   * back-reference to which link they came through, nothing cascades away.
   * Conditional on `quizId` (not just `id`) so it can't delete a link that
   * doesn't belong to the quiz the caller already scoped to.
   */
  async remove(id: string, quizId: string): Promise<boolean> {
    const { count } = await this.prisma.quizLink.deleteMany({
      where: { id, quizId },
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
        AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
    `;
    return affected === 1;
  }
}
