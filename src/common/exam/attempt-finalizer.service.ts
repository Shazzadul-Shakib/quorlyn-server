import { Injectable, Logger } from '@nestjs/common';
import { Attempt, Quiz, SubmissionCause } from '@prisma/client';
import { CLOCK, type Clock } from '../clock/clock';
import { AttemptRepository } from '../repositories/attempt.repository';
import { AttemptAnswerRepository } from '../repositories/attempt-answer.repository';
import { QuestionRepository } from '../repositories/question.repository';
import { PrismaTransactionRunner } from '../prisma/transaction-runner';
import { GradingService } from './grading.service';
import { QuizPolicyService } from './quiz-policy.service';
import { Inject } from '@nestjs/common';

export const HEARTBEAT_GRACE_SECONDS = 90;

export interface FinalizationResult {
  attempt: Attempt;
  /** False when someone else finalized it first — the caller just re-reads. */
  finalizedByUs: boolean;
}

/**
 * The single path an attempt takes to SUBMITTED, whether the student pressed
 * submit, the timer ran out, the connection died, or the sweeper found it
 * (ADR-0015). Idempotent by construction: the status flip is a conditional
 * update inside the grading transaction.
 */
@Injectable()
export class AttemptFinalizerService {
  private readonly logger = new Logger(AttemptFinalizerService.name);

  constructor(
    private readonly attemptRepository: AttemptRepository,
    private readonly attemptAnswerRepository: AttemptAnswerRepository,
    private readonly questionRepository: QuestionRepository,
    private readonly gradingService: GradingService,
    private readonly quizPolicy: QuizPolicyService,
    private readonly transactionRunner: PrismaTransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Finalizes only if the attempt is actually due — a cheap timestamp
   * comparison on rows already loaded, so it can sit on every read path
   * without adding a query.
   */
  async finalizeIfDue(
    attempt: Attempt,
    quiz: Quiz,
  ): Promise<FinalizationResult> {
    const due = this.dueCause(attempt, quiz);
    if (!due) {
      return { attempt, finalizedByUs: false };
    }
    return this.finalize(attempt, quiz, due.cause, due.endedAt);
  }

  dueCause(
    attempt: Attempt,
    quiz: Quiz,
  ): { cause: SubmissionCause; endedAt: Date } | null {
    if (attempt.status !== 'IN_PROGRESS') {
      return null;
    }
    const now = this.clock.now();
    const deadline = this.quizPolicy.effectiveDeadline(
      quiz,
      attempt.deadlineAt,
    );

    if (now >= deadline) {
      // The attempt ended when time ran out, not when we noticed.
      return { cause: SubmissionCause.TIMER_EXPIRED, endedAt: deadline };
    }

    const staleAfter = new Date(
      attempt.lastHeartbeatAt.getTime() + HEARTBEAT_GRACE_SECONDS * 1000,
    );
    if (now > staleAfter) {
      return {
        cause: SubmissionCause.DISCONNECTED,
        endedAt: attempt.lastHeartbeatAt,
      };
    }
    return null;
  }

  async finalize(
    attempt: Attempt,
    quiz: Quiz,
    cause: SubmissionCause,
    endedAt: Date = this.clock.now(),
  ): Promise<FinalizationResult> {
    const result = await this.transactionRunner.run(async (tx) => {
      const [questions, answers] = await Promise.all([
        this.questionRepository.findManyWithAnswerKey(quiz.id),
        this.attemptAnswerRepository.findManyByAttempt(attempt.id, tx),
      ]);

      const graded = this.gradingService.grade(questions, answers);
      const finalizedByUs = await this.attemptRepository.finalize(
        attempt.id,
        {
          submittedAt: endedAt,
          submissionCause: cause,
          score: graded.score,
        },
        tx,
      );

      if (finalizedByUs) {
        await this.attemptAnswerRepository.applyGrades(graded.grades, tx);
      }
      return finalizedByUs;
    });

    const fresh = await this.attemptRepository.findById(attempt.id);
    if (result) {
      this.logger.log(
        `Attempt ${attempt.id} finalized (${cause}) score=${fresh?.score ?? 0}/${fresh?.maxScore ?? 0}`,
      );
    }
    return { attempt: fresh ?? attempt, finalizedByUs: result };
  }
}
