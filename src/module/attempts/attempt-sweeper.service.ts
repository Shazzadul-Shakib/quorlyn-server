import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AttemptRepository } from '../../common/repositories/attempt.repository';
import {
  AttemptFinalizerService,
  HEARTBEAT_GRACE_SECONDS,
} from '../../common/exam/attempt-finalizer.service';
import { CLOCK, type Clock } from '../../common/clock/clock';

const BATCH_SIZE = 100;

/**
 * The eager half of finalization (ADR-0015). Lazy finalization on read is
 * what makes the data correct; this only makes leaderboards and dashboards
 * settle without someone opening them. If it stops, nothing is wrong — things
 * just settle later.
 *
 * Safe to run on every instance: the status flip is a conditional update, so
 * two sweepers cannot double-grade.
 */
@Injectable()
export class AttemptSweeperService {
  private readonly logger = new Logger(AttemptSweeperService.name);

  constructor(
    private readonly attemptRepository: AttemptRepository,
    private readonly finalizer: AttemptFinalizerService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweep(): Promise<void> {
    const now = this.clock.now();
    const staleBefore = new Date(
      now.getTime() - HEARTBEAT_GRACE_SECONDS * 1000,
    );

    // Bounded per tick so a backlog can never turn one tick into a long
    // transaction.
    const due = await this.attemptRepository.findDueForFinalization(
      now,
      staleBefore,
      BATCH_SIZE,
    );
    if (due.length === 0) {
      return;
    }

    let finalized = 0;
    for (const attempt of due) {
      try {
        const result = await this.finalizer.finalizeIfDue(
          attempt,
          attempt.quiz,
        );
        if (result.finalizedByUs) {
          finalized += 1;
        }
      } catch (error) {
        this.logger.error(
          `Failed to finalize attempt ${attempt.id}: ${String(error)}`,
        );
      }
    }
    if (finalized > 0) {
      this.logger.log(`Sweeper finalized ${finalized} attempt(s)`);
    }
  }
}
