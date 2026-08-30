import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QuizStatus, SubmissionCause } from '@prisma/client';
import {
  QuizRepository,
  type QuizWithCreator,
} from '../../common/repositories/quiz.repository';
import { QuestionRepository } from '../../common/repositories/question.repository';
import { AttemptRepository } from '../../common/repositories/attempt.repository';
import { PrismaTransactionRunner } from '../../common/prisma/transaction-runner';
import { QuizPolicyService } from '../../common/exam/quiz-policy.service';
import { AttemptFinalizerService } from '../../common/exam/attempt-finalizer.service';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { QuizResponseDto } from './dto/quiz-response.dto';
import { toQuizResponse } from './dto/quiz-response.util';
import { ListQuizzesQueryDto } from './dto/list-quizzes.query.dto';

@Injectable()
export class QuizzesService {
  constructor(
    private readonly quizRepository: QuizRepository,
    private readonly questionRepository: QuestionRepository,
    private readonly attemptRepository: AttemptRepository,
    private readonly quizPolicy: QuizPolicyService,
    private readonly finalizer: AttemptFinalizerService,
    private readonly transactionRunner: PrismaTransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(
    dto: CreateQuizDto,
    organizationId: string,
    createdById: string,
  ): Promise<QuizResponseDto> {
    const quiz = await this.quizRepository.create({
      organizationId,
      createdById,
      title: dto.title,
      description: dto.description,
      language: dto.language,
      subject: dto.subject,
      durationSeconds: dto.durationSeconds,
      opensAt: dto.opensAt ? new Date(dto.opensAt) : null,
      closesAt: dto.closesAt ? new Date(dto.closesAt) : null,
      maxAttempts: dto.maxAttempts,
      scoringPolicy: dto.scoringPolicy,
      lateStartCutoff: dto.lateStartCutoff,
      shuffleQuestions: dto.shuffleQuestions,
      maxFocusViolations: dto.maxFocusViolations,
      leaderboardVisibleToStudents: dto.leaderboardVisibleToStudents,
    });
    return toQuizResponse(quiz, 0);
  }

  async list(
    organizationId: string,
    query: ListQuizzesQueryDto,
    currentUserId: string,
  ): Promise<{ items: QuizResponseDto[]; total: number }> {
    const filter = {
      organizationId,
      status: query.status,
      createdById: query.mine ? currentUserId : undefined,
      take: query.take,
      skip: query.skip,
    };
    const [quizzes, total] = await Promise.all([
      this.quizRepository.findMany(filter),
      this.quizRepository.count(filter),
    ]);
    const counts = await Promise.all(
      quizzes.map((quiz) => this.questionRepository.countByQuiz(quiz.id)),
    );
    return {
      items: quizzes.map((quiz, index) => toQuizResponse(quiz, counts[index])),
      total,
    };
  }

  async findById(id: string, organizationId: string): Promise<QuizResponseDto> {
    const quiz = await this.requireQuiz(id, organizationId);
    return toQuizResponse(
      quiz,
      await this.questionRepository.countByQuiz(quiz.id),
    );
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateQuizDto,
  ): Promise<QuizResponseDto> {
    const quiz = await this.requireQuiz(id, organizationId);
    this.quizPolicy.assertSettingsEditable(quiz, Object.keys(dto));

    const updated = await this.quizRepository.update(id, {
      ...dto,
      opensAt: dto.opensAt === undefined ? undefined : new Date(dto.opensAt),
      closesAt: dto.closesAt === undefined ? undefined : new Date(dto.closesAt),
    });
    return toQuizResponse(
      updated,
      await this.questionRepository.countByQuiz(id),
    );
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.requireQuiz(id, organizationId);
    const deleted = await this.quizRepository.deleteDraft(id);
    if (!deleted) {
      throw new ConflictException(
        'Only draft quizzes can be deleted; archive a published quiz instead',
      );
    }
  }

  /** Validates once here so the exam runtime can assume a well-formed quiz. */
  async publish(id: string, organizationId: string): Promise<QuizResponseDto> {
    const quiz = await this.requireQuiz(id, organizationId);
    const questions = await this.questionRepository.findManyWithAnswerKey(id);
    this.quizPolicy.assertPublishable(quiz, questions);

    const published = await this.transactionRunner.run(async (tx) => {
      await this.quizRepository.recalculateTotalPoints(id, tx);
      return this.quizRepository.transitionStatus(
        id,
        [QuizStatus.DRAFT],
        QuizStatus.PUBLISHED,
        { publishedAt: this.clock.now() },
        tx,
      );
    });
    if (!published) {
      throw new ConflictException('Only draft quizzes can be published');
    }
    return toQuizResponse(published, questions.length);
  }

  /** Closing stops new attempts and finalizes the ones still in flight. */
  async close(id: string, organizationId: string): Promise<QuizResponseDto> {
    const quiz = await this.requireQuiz(id, organizationId);
    const closed = await this.transitionToClosed(id);
    if (!closed) {
      throw new ConflictException('Only published quizzes can be closed');
    }
    return toQuizResponse(
      closed,
      await this.questionRepository.countByQuiz(quiz.id),
    );
  }

  /**
   * System-triggered equivalent of `close()` — same status flip and
   * in-flight-attempt finalization, minus the org-scoped lookup and the
   * "already closed" 409, since the caller (`QuizClosingSweeperService`) has
   * no authenticated org context and treats "nothing to do" as a normal
   * outcome, not an error. Returns whether it actually closed the quiz.
   */
  async autoClose(id: string): Promise<boolean> {
    return (await this.transitionToClosed(id)) !== null;
  }

  private async transitionToClosed(
    id: string,
  ): Promise<QuizWithCreator | null> {
    const closed = await this.quizRepository.transitionStatus(
      id,
      [QuizStatus.PUBLISHED],
      QuizStatus.CLOSED,
      { closedAt: this.clock.now() },
    );
    if (!closed) {
      return null;
    }

    const inFlight = await this.attemptRepository.findInProgressByQuiz(id);
    for (const attempt of inFlight) {
      await this.finalizer.finalize(
        attempt,
        closed,
        SubmissionCause.QUIZ_CLOSED,
      );
    }
    return closed;
  }

  async archive(id: string, organizationId: string): Promise<QuizResponseDto> {
    await this.requireQuiz(id, organizationId);
    const archived = await this.quizRepository.transitionStatus(
      id,
      [QuizStatus.PUBLISHED, QuizStatus.CLOSED],
      QuizStatus.ARCHIVED,
    );
    if (!archived) {
      throw new ConflictException(
        'Only published or closed quizzes can be archived',
      );
    }
    return toQuizResponse(
      archived,
      await this.questionRepository.countByQuiz(id),
    );
  }

  /**
   * The supported way to "edit" a published quiz (ADR-0010): a deep copy in
   * DRAFT, leaving the original and its results untouched.
   *
   * One question per round trip adds up under real network latency to the
   * database (observed: a 2-question duplicate taking ~9s against Neon), so
   * the inserts run concurrently on the same transaction connection instead
   * of a sequential `for` loop, and the transaction gets a longer timeout
   * than Prisma's 5s interactive-transaction default so a slow-but-alive
   * connection doesn't get treated as stuck and aborted mid-copy.
   */
  async duplicate(
    id: string,
    organizationId: string,
    createdById: string,
  ): Promise<QuizResponseDto> {
    const source = await this.requireQuiz(id, organizationId);
    const questions = await this.questionRepository.findManyWithAnswerKey(id);

    const copy = await this.transactionRunner.run(
      async (tx) => {
        const quiz = await this.quizRepository.create(
          {
            organizationId,
            createdById,
            title: `${source.title} (copy)`,
            description: source.description ?? undefined,
            language: source.language,
            subject: source.subject ?? undefined,
            durationSeconds: source.durationSeconds,
            opensAt: source.opensAt,
            closesAt: source.closesAt,
            maxAttempts: source.maxAttempts,
            scoringPolicy: source.scoringPolicy,
            lateStartCutoff: source.lateStartCutoff,
            shuffleQuestions: source.shuffleQuestions,
            maxFocusViolations: source.maxFocusViolations,
            leaderboardVisibleToStudents: source.leaderboardVisibleToStudents,
          },
          tx,
        );

        await Promise.all(
          questions.map((question) =>
            this.questionRepository.create(
              {
                quizId: quiz.id,
                type: question.type,
                prompt: question.prompt,
                contentFormat: question.contentFormat,
                points: question.points,
                position: question.position,
                options: question.options.map((option) => ({
                  text: option.text,
                  isCorrect: option.isCorrect,
                })),
              },
              tx,
            ),
          ),
        );
        await this.quizRepository.recalculateTotalPoints(quiz.id, tx);
        return quiz;
      },
      { timeout: 15_000 },
    );

    return toQuizResponse(copy, questions.length);
  }

  async requireQuiz(
    id: string,
    organizationId: string,
  ): Promise<QuizWithCreator> {
    const quiz = await this.quizRepository.findByIdInOrg(id, organizationId);
    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }
    return quiz;
  }
}
