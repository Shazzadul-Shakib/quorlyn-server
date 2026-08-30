import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Attempt,
  AttemptStatus,
  MembershipStatus,
  OrgRole,
  PlatformRole,
  ProctorEventType,
  Quiz,
  QuizStatus,
  SubmissionCause,
} from '@prisma/client';
import type { OrgClaim } from '../../common/token/jwt-payload.interface';
import { AttemptRepository } from '../../common/repositories/attempt.repository';
import { AttemptAnswerRepository } from '../../common/repositories/attempt-answer.repository';
import { QuestionRepository } from '../../common/repositories/question.repository';
import { QuizRepository } from '../../common/repositories/quiz.repository';
import { QuizLinkRepository } from '../../common/repositories/quiz-link.repository';
import { MembershipRepository } from '../../common/repositories/membership.repository';
import { ProctorEventRepository } from '../../common/repositories/proctor-event.repository';
import { UserRepository } from '../../common/repositories/user.repository';
import { UniqueConstraintViolationError } from '../../common/repositories/errors';
import { PrismaTransactionRunner } from '../../common/prisma/transaction-runner';
import { QuizPolicyService } from '../../common/exam/quiz-policy.service';
import { AttemptFinalizerService } from '../../common/exam/attempt-finalizer.service';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { seededShuffle } from '../../common/utils/shuffle.util';
import { hashToken } from '../../common/utils/token.util';
import { toExamQuestion } from '../quizzes/dto/question-response.util';
import { AttemptResponseDto } from './dto/attempt-response.dto';
import { ExamStateResponseDto } from './dto/exam-state-response.dto';
import { HeartbeatResponseDto } from './dto/heartbeat-response.dto';
import { ReportEventsDto } from './dto/report-events.dto';
import { AttemptDetailResponseDto } from './dto/attempt-detail-response.dto';

export interface AttemptContext {
  userId: string;
  deviceId: string | null;
  ipAddress?: string;
  userAgent?: string;
}

/** Only these count toward the auto-submit limit — blur is too noisy (ADR-0016). */
const COUNTED_VIOLATIONS: ProctorEventType[] = [
  ProctorEventType.TAB_HIDDEN,
  ProctorEventType.FULLSCREEN_EXIT,
];

@Injectable()
export class AttemptsService {
  constructor(
    private readonly attemptRepository: AttemptRepository,
    private readonly attemptAnswerRepository: AttemptAnswerRepository,
    private readonly questionRepository: QuestionRepository,
    private readonly quizRepository: QuizRepository,
    private readonly quizLinkRepository: QuizLinkRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly proctorEventRepository: ProctorEventRepository,
    private readonly userRepository: UserRepository,
    private readonly quizPolicy: QuizPolicyService,
    private readonly finalizer: AttemptFinalizerService,
    private readonly transactionRunner: PrismaTransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Starting is idempotent: an in-progress attempt is resumed rather than
   * duplicated, so a reconnecting student neither loses time nor spends
   * another allowance (ADR-0014).
   */
  async start(
    quizId: string,
    org: OrgClaim,
    platformRole: PlatformRole,
    context: AttemptContext,
  ): Promise<AttemptResponseDto> {
    this.assertStudentEligible(platformRole, org);
    const quiz = await this.requireQuizInOrg(quizId, org.id);
    return this.startForQuiz(quiz, context, null);
  }

  /** Link entry point: resolves the link, enrols the student, then starts. */
  async startFromLink(
    rawToken: string,
    platformRole: PlatformRole,
    context: AttemptContext,
  ): Promise<AttemptResponseDto> {
    const link = await this.quizLinkRepository.findByTokenHashWithQuiz(
      hashToken(rawToken),
    );
    if (!link) {
      // A deleted link (formerly "revoked") isn't distinguishable from one
      // that never existed — the row is simply gone.
      throw new NotFoundException('Link not found');
    }

    const now = this.clock.now();
    if (link.expiresAt && link.expiresAt <= now) {
      throw new GoneException('This link has expired');
    }

    const membership = await this.membershipRepository.findByUserAndOrg(
      context.userId,
      link.quiz.organizationId,
    );
    if (membership && membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(
        'Your membership of this organization is suspended',
      );
    }
    this.assertStudentEligible(platformRole, membership);

    // A student already enrolled through this link keeps their access even
    // once maxUses is reached — otherwise a reconnect locks them out.
    const priorAttempts = await this.attemptRepository.countForUser(
      link.quizId,
      context.userId,
    );
    const isFirstEntry = !membership || priorAttempts === 0;

    if (!membership) {
      await this.membershipRepository.create({
        userId: context.userId,
        organizationId: link.quiz.organizationId,
        role: OrgRole.STUDENT,
      });
    }

    if (isFirstEntry) {
      const consumed = await this.quizLinkRepository.tryConsumeUse(link.id);
      if (!consumed) {
        throw new GoneException('This link has reached its limit');
      }
    }

    return this.startForQuiz(link.quiz, context, link.id);
  }

  private async startForQuiz(
    quiz: Quiz,
    context: AttemptContext,
    quizLinkId: string | null,
  ): Promise<AttemptResponseDto> {
    const existing = await this.attemptRepository.findInProgressForUser(
      quiz.id,
      context.userId,
    );
    if (existing) {
      const { attempt } = await this.finalizer.finalizeIfDue(existing, quiz);
      if (attempt.status === AttemptStatus.IN_PROGRESS) {
        if (context.deviceId && attempt.deviceId !== context.deviceId) {
          // Resuming elsewhere is allowed — that is disconnect recovery — but
          // it is recorded for the teacher to judge (ADR-0016/0017).
          await this.recordEvents(attempt.id, [
            ProctorEventType.DEVICE_CHANGED,
            ProctorEventType.RECONNECT,
          ]);
          await this.attemptRepository.bindDevice(attempt.id, context.deviceId);
        }
        return this.toAttemptResponse(attempt, quiz);
      }
    }

    const attempt = await this.transactionRunner
      .run(async (tx) => {
        const used = await this.attemptRepository.countForUser(
          quiz.id,
          context.userId,
          tx,
        );
        const { deadlineAt } = this.quizPolicy.resolveStartWindow(
          quiz,
          used,
          this.clock.now(),
        );
        return this.attemptRepository.create(
          {
            quizId: quiz.id,
            userId: context.userId,
            organizationId: quiz.organizationId,
            quizLinkId,
            attemptNumber: used + 1,
            deadlineAt,
            maxScore: quiz.totalPoints,
            deviceId: context.deviceId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
          tx,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof UniqueConstraintViolationError) {
          throw new ConflictException(
            'Another start for this quiz is already in progress',
          );
        }
        throw error;
      });

    return this.toAttemptResponse(attempt, quiz);
  }

  /** The exam screen: questions without the answer key, plus saved answers. */
  async examState(
    attemptId: string,
    userId: string,
  ): Promise<ExamStateResponseDto> {
    const { attempt, quiz } = await this.requireOwnAttempt(attemptId, userId);
    const settled = await this.finalizer.finalizeIfDue(attempt, quiz);

    const [questions, answers] = await Promise.all([
      this.questionRepository.findManyForExam(quiz.id),
      this.attemptAnswerRepository.findManyByAttempt(attemptId),
    ]);

    const ordered = quiz.shuffleQuestions
      ? seededShuffle(questions, attempt.id)
      : questions;

    return {
      attempt: this.toAttemptResponse(settled.attempt, quiz),
      questions: ordered.map((question) => {
        const options = quiz.shuffleQuestions
          ? seededShuffle(question.options, `${attempt.id}:${question.id}`)
          : question.options;
        return toExamQuestion({ ...question, options });
      }),
      answers: answers.map((answer) => ({
        questionId: answer.questionId,
        selectedOptionIds: answer.selectedOptionIds,
      })),
    };
  }

  /** Autosave: one question at a time, so a disconnect never loses work. */
  async saveAnswer(
    attemptId: string,
    questionId: string,
    userId: string,
    selectedOptionIds: string[],
  ): Promise<void> {
    const { attempt, quiz } = await this.requireOwnAttempt(attemptId, userId);
    this.assertOpenForAnswers(attempt, quiz);

    const question = await this.questionRepository.findByIdInQuizForExam(
      questionId,
      quiz.id,
    );
    if (!question) {
      throw new NotFoundException('Question not found in this quiz');
    }

    const validIds = new Set(question.options.map((option) => option.id));
    const unknown = selectedOptionIds.filter((id) => !validIds.has(id));
    if (unknown.length > 0) {
      throw new NotFoundException('Option does not belong to this question');
    }

    await this.attemptAnswerRepository.upsert(attemptId, questionId, [
      ...new Set(selectedOptionIds),
    ]);
  }

  async heartbeat(
    attemptId: string,
    userId: string,
  ): Promise<HeartbeatResponseDto> {
    const { attempt, quiz } = await this.requireOwnAttempt(attemptId, userId);
    const { attempt: settled } = await this.finalizer.finalizeIfDue(
      attempt,
      quiz,
    );

    if (settled.status === AttemptStatus.IN_PROGRESS) {
      await this.attemptRepository.touchHeartbeat(attemptId, this.clock.now());
    }

    const now = this.clock.now();
    const deadlineAt = this.quizPolicy.effectiveDeadline(
      quiz,
      settled.deadlineAt,
    );
    return {
      status: settled.status,
      serverTime: now,
      deadlineAt,
      remainingMs: Math.max(0, deadlineAt.getTime() - now.getTime()),
      submissionCause: settled.submissionCause,
    };
  }

  async submit(attemptId: string, userId: string): Promise<AttemptResponseDto> {
    const { attempt, quiz } = await this.requireOwnAttempt(attemptId, userId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      return this.toAttemptResponse(attempt, quiz);
    }

    const due = this.finalizer.dueCause(attempt, quiz);
    const { attempt: finalized } = due
      ? await this.finalizer.finalize(attempt, quiz, due.cause, due.endedAt)
      : await this.finalizer.finalize(attempt, quiz, SubmissionCause.MANUAL);

    return this.toAttemptResponse(finalized, quiz);
  }

  /**
   * Records what the client reports. These are advisory signals for a human,
   * never a grading input (ADR-0016).
   */
  async reportEvents(
    attemptId: string,
    userId: string,
    dto: ReportEventsDto,
  ): Promise<AttemptResponseDto> {
    const { attempt, quiz } = await this.requireOwnAttempt(attemptId, userId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      return this.toAttemptResponse(attempt, quiz);
    }

    const types = dto.events.map((event) => event.type);
    await this.recordEvents(
      attemptId,
      types,
      dto.events.map((event) => event.clientTime),
    );

    const counted = types.filter((type) =>
      COUNTED_VIOLATIONS.includes(type),
    ).length;
    let current = attempt.focusViolations;
    if (counted > 0) {
      current = await this.attemptRepository.incrementFocusViolations(
        attemptId,
        counted,
      );
    }

    if (quiz.maxFocusViolations !== null && current > quiz.maxFocusViolations) {
      const { attempt: finalized } = await this.finalizer.finalize(
        { ...attempt, focusViolations: current },
        quiz,
        SubmissionCause.PROCTOR_VIOLATION,
      );
      return this.toAttemptResponse(finalized, quiz);
    }

    return this.toAttemptResponse(
      { ...attempt, focusViolations: current },
      quiz,
    );
  }

  async myAttempts(
    userId: string,
    organizationId: string | undefined,
    take: number,
    skip: number,
  ): Promise<AttemptResponseDto[]> {
    const attempts = await this.attemptRepository.findManyForUser(userId, {
      organizationId,
      take,
      skip,
    });
    const settled = await Promise.all(
      attempts.map(async (attempt) => {
        const { attempt: fresh } = await this.finalizer.finalizeIfDue(
          attempt,
          attempt.quiz,
        );
        return this.toAttemptResponse(fresh, attempt.quiz);
      }),
    );
    return settled;
  }

  /** Teacher view of one attempt, including correctness and the event timeline. */
  async detailForTeacher(
    attemptId: string,
    organizationId: string,
  ): Promise<AttemptDetailResponseDto> {
    const attempt = await this.attemptRepository.findByIdWithQuiz(attemptId);
    if (!attempt || attempt.organizationId !== organizationId) {
      throw new NotFoundException('Attempt not found');
    }
    const { attempt: settled } = await this.finalizer.finalizeIfDue(
      attempt,
      attempt.quiz,
    );

    const [answers, events, student] = await Promise.all([
      this.attemptAnswerRepository.findManyByAttempt(attemptId),
      this.proctorEventRepository.findManyByAttempt(attemptId),
      this.userRepository.findById(attempt.userId),
    ]);

    return {
      attempt: this.toAttemptResponse(settled, attempt.quiz),
      studentEmail: student?.email ?? 'unknown',
      answers: answers.map((answer) => ({
        questionId: answer.questionId,
        selectedOptionIds: answer.selectedOptionIds,
        isCorrect: answer.isCorrect,
        pointsAwarded: answer.pointsAwarded,
      })),
      events: events.map((event) => ({
        type: event.type,
        occurredAt: event.occurredAt,
      })),
    };
  }

  async listForQuiz(
    quizId: string,
    organizationId: string,
    take: number,
    skip: number,
  ): Promise<AttemptResponseDto[]> {
    const quiz = await this.requireQuizInOrg(quizId, organizationId, false);
    const attempts = await this.attemptRepository.findManyByQuiz(
      quizId,
      take,
      skip,
    );
    return Promise.all(
      attempts.map(async (attempt) => {
        const { attempt: fresh } = await this.finalizer.finalizeIfDue(
          attempt,
          quiz,
        );
        return this.toAttemptResponse(fresh, quiz);
      }),
    );
  }

  // ------------------------------------------------------------ helpers

  private async recordEvents(
    attemptId: string,
    types: ProctorEventType[],
    clientTimes: (string | undefined)[] = [],
  ): Promise<void> {
    const now = this.clock.now();
    await this.proctorEventRepository.createMany(
      types.map((type, index) => ({
        attemptId,
        type,
        // Server time, always: a client-supplied timestamp is as forgeable as
        // the timer, so it is kept only as diagnostic metadata.
        occurredAt: now,
        metadata: clientTimes[index]
          ? { clientTime: clientTimes[index] }
          : undefined,
      })),
    );
  }

  /**
   * Sitting an exam is a student-only action. Teachers preview a quiz from
   * the dashboard instead of sitting it, org owners run the organization
   * rather than take its quizzes, and the superadmin sits outside every
   * organization by design (ADR-0002) — none of them should be able to
   * consume an attempt slot or appear in a class's results.
   */
  private assertStudentEligible(
    platformRole: PlatformRole,
    membership: { role: OrgRole; isOrgOwner: boolean } | null,
  ): void {
    if (platformRole === PlatformRole.SUPERADMIN) {
      throw new ForbiddenException('Superadmins cannot sit an exam');
    }
    if (membership?.isOrgOwner) {
      throw new ForbiddenException('Organization owners cannot sit an exam');
    }
    if (membership?.role === OrgRole.TEACHER) {
      throw new ForbiddenException(
        'Teachers preview a quiz from the dashboard rather than sitting it',
      );
    }
  }

  private assertOpenForAnswers(attempt: Attempt, quiz: Quiz): void {
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new GoneException('This attempt has already been submitted');
    }
    const deadline = this.quizPolicy.effectiveDeadline(
      quiz,
      attempt.deadlineAt,
    );
    if (this.clock.now() >= deadline) {
      throw new GoneException('Time is up for this attempt');
    }
  }

  private async requireOwnAttempt(
    attemptId: string,
    userId: string,
  ): Promise<{ attempt: Attempt; quiz: Quiz }> {
    const attempt = await this.attemptRepository.findByIdWithQuiz(attemptId);
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundException('Attempt not found');
    }
    return { attempt, quiz: attempt.quiz };
  }

  private async requireQuizInOrg(
    quizId: string,
    organizationId: string,
    mustBePublished = true,
  ): Promise<Quiz> {
    const quiz = await this.quizRepository.findByIdInOrg(
      quizId,
      organizationId,
    );
    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }
    if (mustBePublished && quiz.status !== QuizStatus.PUBLISHED) {
      throw new ConflictException('This quiz is not open for attempts');
    }
    return quiz;
  }

  private toAttemptResponse(attempt: Attempt, quiz: Quiz): AttemptResponseDto {
    const now = this.clock.now();
    const deadlineAt = this.quizPolicy.effectiveDeadline(
      quiz,
      attempt.deadlineAt,
    );
    return {
      id: attempt.id,
      quizId: attempt.quizId,
      quizTitle: quiz.title,
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadlineAt,
      serverTime: now,
      remainingMs:
        attempt.status === AttemptStatus.IN_PROGRESS
          ? Math.max(0, deadlineAt.getTime() - now.getTime())
          : 0,
      submittedAt: attempt.submittedAt,
      submissionCause: attempt.submissionCause,
      score: attempt.score,
      maxScore: attempt.maxScore,
      focusViolations: attempt.focusViolations,
      maxFocusViolations: quiz.maxFocusViolations,
    };
  }
}
