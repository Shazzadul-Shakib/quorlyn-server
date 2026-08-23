import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuizLink, QuizStatus } from '@prisma/client';
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
   */
  async create(
    quizId: string,
    organizationId: string,
    createdById: string,
    dto: CreateQuizLinkDto,
  ): Promise<QuizLinkResponseDto> {
    await this.quizzesService.requireQuiz(quizId, organizationId);
    const rawToken = generateOpaqueToken();
    const link = await this.quizLinkRepository.create({
      quizId,
      tokenHash: hashToken(rawToken),
      createdById,
      label: dto.label,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      maxUses: dto.maxUses ?? null,
    });
    return this.toResponse(link, rawToken);
  }

  async list(
    quizId: string,
    organizationId: string,
  ): Promise<QuizLinkResponseDto[]> {
    await this.quizzesService.requireQuiz(quizId, organizationId);
    const links = await this.quizLinkRepository.findManyByQuiz(quizId);
    return links.map((link) => this.toResponse(link, null));
  }

  async revoke(
    quizId: string,
    linkId: string,
    organizationId: string,
  ): Promise<void> {
    await this.quizzesService.requireQuiz(quizId, organizationId);
    const link = await this.quizLinkRepository.findByIdInQuiz(linkId, quizId);
    if (!link) {
      throw new NotFoundException('Link not found');
    }
    await this.quizLinkRepository.revoke(linkId, this.clock.now());
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
    const acceptingAttempts =
      link.revokedAt === null &&
      (link.expiresAt === null || link.expiresAt > now) &&
      (link.maxUses === null || link.usedCount < link.maxUses) &&
      link.quiz.status === QuizStatus.PUBLISHED &&
      (link.quiz.opensAt === null || link.quiz.opensAt <= now) &&
      (link.quiz.closesAt === null || link.quiz.closesAt > now);

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

  private toResponse(
    link: QuizLink,
    rawToken: string | null,
  ): QuizLinkResponseDto {
    return {
      id: link.id,
      quizId: link.quizId,
      label: link.label,
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
      usedCount: link.usedCount,
      revokedAt: link.revokedAt,
      createdAt: link.createdAt,
      token: rawToken,
      url: rawToken ? `${this.frontendUrl}/exam/${rawToken}` : null,
    };
  }
}
