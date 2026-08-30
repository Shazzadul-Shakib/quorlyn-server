import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Quiz, QuizLink, QuizStatus } from '@prisma/client';
import { QuizLinkRepository } from '../../common/repositories/quiz-link.repository';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { QuestionRepository } from '../../common/repositories/question.repository';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { EnvConfig } from '../../common/config/env.validation';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import { CreateQuizLinkDto } from './dto/create-quiz-link.dto';
import { QuizLinkResponseDto } from './dto/quiz-link-response.dto';
import { QuizLinkPreviewResponseDto } from './dto/quiz-link-preview-response.dto';
import { QuizzesService } from './quizzes.service';

@Injectable()
export class QuizLinksService {
  private readonly frontendUrl: string;

  constructor(
    private readonly quizLinkRepository: QuizLinkRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly questionRepository: QuestionRepository,
    private readonly quizzesService: QuizzesService,
    configService: ConfigService<EnvConfig, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.frontendUrl = configService.get('FRONTEND_URL', { infer: true });
  }

  /**
   * The raw token is returned exactly once — only its sha256 is stored, like
   * every other token in this system (ADR-0013).
   *
   * Only one active link per quiz at a time: sharing several live links for
   * the same quiz made it unclear which one was "the" link and left stale
   * ones nobody remembered to remove. A teacher deletes (or waits out the
   * expiry of) the current one before minting another. "Active" here is the
   * same full `acceptingAttempts` check as everywhere else — in practice
   * nobody sets a link's own `expiresAt`, they rely on the quiz's `closesAt`,
   * so this must fold in the quiz's own window or it would never re-open.
   */
  async create(
    quizId: string,
    organizationId: string,
    createdById: string,
    dto: CreateQuizLinkDto,
  ): Promise<QuizLinkResponseDto> {
    const quiz = await this.quizzesService.requireQuiz(quizId, organizationId);
    const now = this.clock.now();
    const existing = await this.quizLinkRepository.findManyByQuiz(quizId);
    if (existing.some((link) => this.acceptingAttempts(link, quiz, now))) {
      throw new ConflictException(
        'This quiz already has an active link — delete it or wait for it to expire before creating another.',
      );
    }
    const rawToken = generateOpaqueToken();
    const link = await this.quizLinkRepository.create({
      quizId,
      tokenHash: hashToken(rawToken),
      createdById,
      label: dto.label,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      maxUses: dto.maxUses ?? null,
    });
    return this.toResponse(
      link,
      rawToken,
      this.acceptingAttempts(link, quiz, now),
    );
  }

  async list(
    quizId: string,
    organizationId: string,
  ): Promise<QuizLinkResponseDto[]> {
    const quiz = await this.quizzesService.requireQuiz(quizId, organizationId);
    const now = this.clock.now();
    const links = await this.quizLinkRepository.findManyByQuiz(quizId);
    return links.map((link) =>
      this.toResponse(link, null, this.acceptingAttempts(link, quiz, now)),
    );
  }

  /** A hard delete (ADR-0013 amendment, 2026-08-30) — see `QuizLinkRepository.remove`. */
  async remove(
    quizId: string,
    linkId: string,
    organizationId: string,
  ): Promise<void> {
    await this.quizzesService.requireQuiz(quizId, organizationId);
    const removed = await this.quizLinkRepository.remove(linkId, quizId);
    if (!removed) {
      throw new NotFoundException('Link not found');
    }
  }

  /** Public: enough to decide whether to sign in, and nothing more. */
  async preview(rawToken: string): Promise<QuizLinkPreviewResponseDto> {
    const link = await this.quizLinkRepository.findByTokenHashWithQuiz(
      hashToken(rawToken),
    );
    if (!link) {
      throw new NotFoundException('Link not found');
    }

    const [organization, questionCount] = await Promise.all([
      this.organizationRepository.findById(link.quiz.organizationId),
      this.questionRepository.countByQuiz(link.quizId),
    ]);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const now = this.clock.now();
    const acceptingAttempts = this.acceptingAttempts(link, link.quiz, now);

    return {
      quizTitle: link.quiz.title,
      quizDescription: link.quiz.description,
      organizationName: organization.name,
      language: link.quiz.language,
      subject: link.quiz.subject,
      durationSeconds: link.quiz.durationSeconds,
      questionCount,
      totalPoints: link.quiz.totalPoints,
      opensAt: link.quiz.opensAt,
      closesAt: link.quiz.closesAt,
      maxAttempts: link.quiz.maxAttempts,
      acceptingAttempts,
    };
  }

  /**
   * Whether a new attempt could start through this link *right now* — the
   * one true definition of "active" for a link, used for the one-active-
   * link-at-a-time check, the list view's status, and the public preview.
   * Deliberately folds in the *quiz's* own window and status, not just the
   * link's own `expiresAt`/`maxUses`: a link with no `expiresAt` of its own
   * (the common case — teachers rely on the quiz's `closesAt` instead) would
   * otherwise look permanently active even after the quiz itself closed.
   */
  private acceptingAttempts(link: QuizLink, quiz: Quiz, now: Date): boolean {
    return (
      (link.expiresAt === null || link.expiresAt > now) &&
      (link.maxUses === null || link.usedCount < link.maxUses) &&
      quiz.status === QuizStatus.PUBLISHED &&
      (quiz.opensAt === null || quiz.opensAt <= now) &&
      (quiz.closesAt === null || quiz.closesAt > now)
    );
  }

  private toResponse(
    link: QuizLink,
    rawToken: string | null,
    acceptingAttempts: boolean,
  ): QuizLinkResponseDto {
    return {
      id: link.id,
      quizId: link.quizId,
      label: link.label,
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
      usedCount: link.usedCount,
      createdAt: link.createdAt,
      acceptingAttempts,
      token: rawToken,
      url: rawToken ? `${this.frontendUrl}/exam/${rawToken}` : null,
    };
  }
}
