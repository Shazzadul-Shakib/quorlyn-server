import { Injectable } from '@nestjs/common';
import { ChallengePurpose, EmailChallenge, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateEmailChallengeInput {
  userId: string;
  purpose: ChallengePurpose;
  codeHash: string;
  expiresAt: Date;
}

@Injectable()
export class EmailChallengeRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateEmailChallengeInput): Promise<EmailChallenge> {
    return this.prisma.emailChallenge.create({ data });
  }

  findLatestUnconsumed(
    userId: string,
    purpose: ChallengePurpose,
  ): Promise<EmailChallenge | null> {
    return this.prisma.emailChallenge.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  countRecent(
    userId: string,
    purpose: ChallengePurpose,
    since: Date,
  ): Promise<number> {
    return this.prisma.emailChallenge.count({
      where: { userId, purpose, createdAt: { gte: since } },
    });
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.prisma.emailChallenge.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  /** Conditional consume: returns false if another request already used it. */
  async consume(
    id: string,
    now: Date,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const { count } = await tx.emailChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: now },
    });
    return count === 1;
  }

  async consumeAllForUser(
    userId: string,
    purpose: ChallengePurpose,
    now: Date,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.emailChallenge.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
  }
}
