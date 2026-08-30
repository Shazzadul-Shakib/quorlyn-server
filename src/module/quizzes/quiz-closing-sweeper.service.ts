import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QuizStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { QuizzesService } from './quizzes.service';

const BATCH_SIZE = 100;

/**
 * The eager half of "a quiz's own `closesAt` passing closes it" — mirrors
 * `AttemptSweeperService` and ADR-0015's reasoning: a lazy check already
 * exists where it matters for correctness (`QuizPolicyService.
 * resolveStartWindow` rejects a start once `now >= closesAt` regardless of
 * `Quiz.status`), so this sweeper isn't load-bearing for security — it only
 * keeps `Quiz.status` itself (and anything that lists/filters on it —
 * dashboards, the quiz list, a share link's "active" state) from sitting
 * stale on `PUBLISHED` indefinitely after the deadline the teacher actually
 * set has passed. If this stops running, nothing becomes incorrect; things
 * just settle later.
 *
 * Driven by the quiz's own `closesAt`, not a link's `expiresAt` — this was
 * link-driven at first, which was wrong: a link expiring doesn't mean the
 * exam is over (an existing org member can still start one directly via
 * `POST /quizzes/{id}/attempts`, no link involved, and in practice teachers
 * never set a link's own `expiresAt` at all — they rely on `closesAt`), so
 * that version never actually fired.
 *
 * Safe to run on every instance: closing goes through
 * `QuizzesService.autoClose`, which is the same conditional `transitionStatus`
 * update `close()` uses — two ticks (or a tick racing a manual close) cannot
 * double-close or double-finalize.
 */
@Injectable()
export class QuizClosingSweeperService {
  private readonly logger = new Logger(QuizClosingSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quizzesService: QuizzesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweep(): Promise<void> {
    const now = this.clock.now();

    // Bounded per tick so a backlog can never turn one tick into a long
    // transaction — same guard as AttemptSweeperService.
    const candidates = await this.prisma.quiz.findMany({
      where: {
        status: QuizStatus.PUBLISHED,
        closesAt: { lte: now },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (candidates.length === 0) {
      return;
    }

    let closed = 0;
    for (const { id } of candidates) {
      try {
        if (await this.quizzesService.autoClose(id)) {
          closed += 1;
        }
      } catch (error) {
        this.logger.error(`Failed to auto-close quiz ${id}: ${String(error)}`);
      }
    }
    if (closed > 0) {
      this.logger.log(`Sweeper auto-closed ${closed} quiz(zes) past closesAt`);
    }
  }
}
