import { Injectable } from '@nestjs/common';
import {
  Attempt,
  AttemptStatus,
  Prisma,
  Quiz,
  ScoringPolicy,
  SubmissionCause,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toUniqueConstraintError } from './errors';

export interface CreateAttemptInput {
  quizId: string;
  userId: string;
  organizationId: string;
  quizLinkId?: string | null;
  attemptNumber: number;
  deadlineAt: Date;
  maxScore: number;
  deviceId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

export interface FinalizeAttemptInput {
  submittedAt: Date;
  submissionCause: SubmissionCause;
  score: number;
}

export type AttemptWithQuiz = Attempt & { quiz: Quiz };

export interface LeaderboardRow {
  rank: number;
  userId: string;
  email: string;
  attemptId: string;
  score: number;
  maxScore: number;
  durationMs: number;
  submittedAt: Date;
}

export interface QuizAggregate {
  quizId: string;
  attempts: number;
  students: number;
  averageScore: number | null;
}

export interface QuestionDifficultyRow {
  questionId: string;
  answered: number;
  correct: number;
}

@Injectable()
export class AttemptRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: CreateAttemptInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Attempt> {
    try {
      return await tx.attempt.create({ data });
    } catch (error) {
      // Two concurrent starts collide on (quizId, userId, attemptNumber);
      // the unique index is what keeps one student to one live attempt.
      const conflict = toUniqueConstraintError(error);
      if (conflict) {
        throw conflict;
      }
      throw error;
    }
  }

  findById(id: string): Promise<Attempt | null> {
    return this.prisma.attempt.findUnique({ where: { id } });
  }

  findByIdWithQuiz(id: string): Promise<AttemptWithQuiz | null> {
    return this.prisma.attempt.findUnique({
      where: { id },
      include: { quiz: true },
    });
  }

  findInProgressForUser(
    quizId: string,
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Attempt | null> {
    return tx.attempt.findFirst({
      where: { quizId, userId, status: AttemptStatus.IN_PROGRESS },
    });
  }

  countForUser(
    quizId: string,
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    return tx.attempt.count({ where: { quizId, userId } });
  }

  findManyForUser(
    userId: string,
    filter: {
      quizId?: string;
      organizationId?: string;
      take?: number;
      skip?: number;
    } = {},
  ): Promise<AttemptWithQuiz[]> {
    return this.prisma.attempt.findMany({
      where: {
        userId,
        ...(filter.quizId ? { quizId: filter.quizId } : {}),
        ...(filter.organizationId
          ? { organizationId: filter.organizationId }
          : {}),
      },
      include: { quiz: true },
      orderBy: { startedAt: 'desc' },
      take: filter.take ?? 50,
      skip: filter.skip ?? 0,
    });
  }

  findManyByQuiz(quizId: string, take = 100, skip = 0): Promise<Attempt[]> {
    return this.prisma.attempt.findMany({
      where: { quizId },
      orderBy: { startedAt: 'desc' },
      take,
      skip,
    });
  }

  /** Attempts whose deadline has passed or whose heartbeat has gone stale. */
  findDueForFinalization(
    now: Date,
    staleBefore: Date,
    take: number,
  ): Promise<AttemptWithQuiz[]> {
    return this.prisma.attempt.findMany({
      where: {
        status: AttemptStatus.IN_PROGRESS,
        OR: [
          { deadlineAt: { lte: now } },
          { lastHeartbeatAt: { lt: staleBefore } },
        ],
      },
      include: { quiz: true },
      orderBy: { deadlineAt: 'asc' },
      take,
    });
  }

  findInProgressByQuiz(quizId: string): Promise<AttemptWithQuiz[]> {
    return this.prisma.attempt.findMany({
      where: { quizId, status: AttemptStatus.IN_PROGRESS },
      include: { quiz: true },
    });
  }

  /**
   * Idempotent finalization (ADR-0015): zero rows affected means another
   * caller — a manual submit, the sweeper, a lazy read — got there first.
   */
  async finalize(
    id: string,
    data: FinalizeAttemptInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const { count } = await tx.attempt.updateMany({
      where: { id, status: AttemptStatus.IN_PROGRESS },
      data: { ...data, status: AttemptStatus.SUBMITTED },
    });
    return count === 1;
  }

  async touchHeartbeat(id: string, now: Date): Promise<boolean> {
    const { count } = await this.prisma.attempt.updateMany({
      where: { id, status: AttemptStatus.IN_PROGRESS },
      data: { lastHeartbeatAt: now },
    });
    return count === 1;
  }

  async incrementFocusViolations(
    id: string,
    by: number,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const attempt = await tx.attempt.update({
      where: { id },
      data: { focusViolations: { increment: by } },
      select: { focusViolations: true },
    });
    return attempt.focusViolations;
  }

  async bindDevice(id: string, deviceId: string): Promise<void> {
    await this.prisma.attempt.updateMany({
      where: { id },
      data: { deviceId },
    });
  }

  // ------------------------------------------------------------ analytics

  /**
   * One row per student, chosen by scoring policy, then ranked
   * (ADR-0018). Prisma's query API has no window functions, so this is the
   * one sanctioned drop to SQL — it stays behind this typed method and no
   * service ever sees a query.
   */
  leaderboard(
    quizId: string,
    policy: ScoringPolicy,
    take = 50,
    skip = 0,
  ): Promise<LeaderboardRow[]> {
    return this.prisma.$queryRaw<LeaderboardRow[]>`
      WITH representative AS (
        SELECT DISTINCT ON (a."userId")
          a."userId"      AS user_id,
          a."id"          AS attempt_id,
          COALESCE(a."score", 0) AS score,
          a."maxScore"    AS max_score,
          a."submittedAt" AS submitted_at,
          (EXTRACT(EPOCH FROM (a."submittedAt" - a."startedAt")) * 1000)::int AS duration_ms
        FROM "Attempt" a
        WHERE a."quizId" = ${quizId}
          AND a."status" = 'SUBMITTED'::"AttemptStatus"
        ORDER BY
          a."userId",
          CASE WHEN ${policy}::text = 'BEST'   THEN a."score"       END DESC NULLS LAST,
          CASE WHEN ${policy}::text = 'FIRST'  THEN a."submittedAt" END ASC,
          CASE WHEN ${policy}::text = 'LATEST' THEN a."submittedAt" END DESC
      )
      SELECT
        RANK() OVER (
          ORDER BY r.score DESC, r.duration_ms ASC, r.submitted_at ASC
        )::int              AS "rank",
        r.user_id           AS "userId",
        u."email"           AS "email",
        r.attempt_id        AS "attemptId",
        r.score::int        AS "score",
        r.max_score::int    AS "maxScore",
        r.duration_ms       AS "durationMs",
        r.submitted_at      AS "submittedAt"
      FROM representative r
      JOIN "User" u ON u."id" = r.user_id
      ORDER BY "rank", r.submitted_at
      LIMIT ${take} OFFSET ${skip}
    `;
  }

  async leaderboardEntryForUser(
    quizId: string,
    policy: ScoringPolicy,
    userId: string,
  ): Promise<LeaderboardRow | null> {
    const rows = await this.prisma.$queryRaw<LeaderboardRow[]>`
      WITH representative AS (
        SELECT DISTINCT ON (a."userId")
          a."userId"      AS user_id,
          a."id"          AS attempt_id,
          COALESCE(a."score", 0) AS score,
          a."maxScore"    AS max_score,
          a."submittedAt" AS submitted_at,
          (EXTRACT(EPOCH FROM (a."submittedAt" - a."startedAt")) * 1000)::int AS duration_ms
        FROM "Attempt" a
        WHERE a."quizId" = ${quizId}
          AND a."status" = 'SUBMITTED'::"AttemptStatus"
        ORDER BY
          a."userId",
          CASE WHEN ${policy}::text = 'BEST'   THEN a."score"       END DESC NULLS LAST,
          CASE WHEN ${policy}::text = 'FIRST'  THEN a."submittedAt" END ASC,
          CASE WHEN ${policy}::text = 'LATEST' THEN a."submittedAt" END DESC
      ), ranked AS (
        SELECT
          RANK() OVER (
            ORDER BY r.score DESC, r.duration_ms ASC, r.submitted_at ASC
          )::int           AS "rank",
          r.user_id        AS "userId",
          u."email"        AS "email",
          r.attempt_id     AS "attemptId",
          r.score::int     AS "score",
          r.max_score::int AS "maxScore",
          r.duration_ms    AS "durationMs",
          r.submitted_at   AS "submittedAt"
        FROM representative r
        JOIN "User" u ON u."id" = r.user_id
      )
      SELECT * FROM ranked WHERE "userId" = ${userId}
    `;
    return rows[0] ?? null;
  }

  async aggregateByQuiz(quizIds: string[]): Promise<QuizAggregate[]> {
    if (quizIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.$queryRaw<
      {
        quizId: string;
        attempts: bigint;
        students: bigint;
        averageScore: number | null;
      }[]
    >`
      SELECT
        a."quizId"                          AS "quizId",
        COUNT(*)                            AS "attempts",
        COUNT(DISTINCT a."userId")          AS "students",
        AVG(a."score")::float               AS "averageScore"
      FROM "Attempt" a
      WHERE a."quizId" = ANY(${quizIds})
        AND a."status" = 'SUBMITTED'::"AttemptStatus"
      GROUP BY a."quizId"
    `;
    return rows.map((row) => ({
      quizId: row.quizId,
      attempts: Number(row.attempts),
      students: Number(row.students),
      averageScore: row.averageScore,
    }));
  }

  async scoreDistribution(
    quizId: string,
    buckets = 10,
  ): Promise<{ bucket: number; count: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { bucket: number; count: bigint }[]
    >`
      SELECT
        LEAST(
          FLOOR(
            (COALESCE(a."score", 0)::float / NULLIF(a."maxScore", 0)) * ${buckets}
          )::int,
          ${buckets} - 1
        )        AS "bucket",
        COUNT(*) AS "count"
      FROM "Attempt" a
      WHERE a."quizId" = ${quizId}
        AND a."status" = 'SUBMITTED'::"AttemptStatus"
        AND a."maxScore" > 0
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map((row) => ({
      bucket: row.bucket,
      count: Number(row.count),
    }));
  }

  async countSubmittedInPeriod(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.attempt.count({
      where: {
        organizationId,
        status: AttemptStatus.SUBMITTED,
        submittedAt: { gte: from, lte: to },
      },
    });
  }

  async countDistinctStudents(quizId: string): Promise<number> {
    const rows = await this.prisma.attempt.findMany({
      where: { quizId, status: AttemptStatus.SUBMITTED },
      distinct: ['userId'],
      select: { userId: true },
    });
    return rows.length;
  }

  async causeBreakdown(
    quizId: string,
  ): Promise<{ cause: SubmissionCause; count: number }[]> {
    const rows = await this.prisma.attempt.groupBy({
      by: ['submissionCause'],
      where: { quizId, status: AttemptStatus.SUBMITTED },
      _count: { _all: true },
    });
    return rows
      .filter(
        (row): row is typeof row & { submissionCause: SubmissionCause } =>
          row.submissionCause !== null,
      )
      .map((row) => ({ cause: row.submissionCause, count: row._count._all }));
  }
}
