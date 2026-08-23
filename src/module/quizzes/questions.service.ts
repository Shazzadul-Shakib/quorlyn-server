import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentFormat, Quiz } from '@prisma/client';
import { QuestionRepository } from '../../common/repositories/question.repository';
import { QuizRepository } from '../../common/repositories/quiz.repository';
import { PrismaTransactionRunner } from '../../common/prisma/transaction-runner';
import { QuizPolicyService } from '../../common/exam/quiz-policy.service';
import { assertValidContent } from '../../common/content/content.util';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { AnswerKeyQuestionDto } from './dto/question-response.dto';
import { toAnswerKeyQuestion } from './dto/question-response.util';
import { QuizzesService } from './quizzes.service';

@Injectable()
export class QuestionsService {
  constructor(
    private readonly questionRepository: QuestionRepository,
    private readonly quizRepository: QuizRepository,
    private readonly quizzesService: QuizzesService,
    private readonly quizPolicy: QuizPolicyService,
    private readonly transactionRunner: PrismaTransactionRunner,
  ) {}

  async list(
    quizId: string,
    organizationId: string,
  ): Promise<AnswerKeyQuestionDto[]> {
    await this.quizzesService.requireQuiz(quizId, organizationId);
    const questions =
      await this.questionRepository.findManyWithAnswerKey(quizId);
    return questions.map(toAnswerKeyQuestion);
  }

  async create(
    quizId: string,
    organizationId: string,
    dto: CreateQuestionDto,
  ): Promise<AnswerKeyQuestionDto> {
    const quiz = await this.requireDraft(quizId, organizationId);
    const contentFormat = dto.contentFormat ?? ContentFormat.LATEX_MIXED;
    this.validateContent(dto.prompt, dto.options, contentFormat);

    const question = await this.transactionRunner.run(async (tx) => {
      const position =
        (await this.questionRepository.maxPosition(quiz.id, tx)) + 1;
      const created = await this.questionRepository.create(
        {
          quizId: quiz.id,
          type: dto.type,
          prompt: dto.prompt.trim(),
          contentFormat,
          points: dto.points ?? 1,
          position,
          options: dto.options.map((option) => ({
            text: option.text.trim(),
            isCorrect: option.isCorrect,
          })),
        },
        tx,
      );
      await this.quizRepository.recalculateTotalPoints(quiz.id, tx);
      return created;
    });

    return toAnswerKeyQuestion(question);
  }

  async update(
    quizId: string,
    questionId: string,
    organizationId: string,
    dto: UpdateQuestionDto,
  ): Promise<AnswerKeyQuestionDto> {
    const quiz = await this.requireDraft(quizId, organizationId);
    const existing = await this.questionRepository.findByIdInQuiz(
      questionId,
      quiz.id,
    );
    if (!existing) {
      throw new NotFoundException('Question not found');
    }

    const contentFormat = dto.contentFormat ?? existing.contentFormat;
    this.validateContent(dto.prompt, dto.options, contentFormat);

    const updated = await this.transactionRunner.run(async (tx) => {
      const question = await this.questionRepository.update(
        questionId,
        {
          type: dto.type,
          prompt: dto.prompt?.trim(),
          contentFormat: dto.contentFormat,
          points: dto.points,
          options: dto.options?.map((option) => ({
            text: option.text.trim(),
            isCorrect: option.isCorrect,
          })),
        },
        tx,
      );
      await this.quizRepository.recalculateTotalPoints(quiz.id, tx);
      return question;
    });

    return toAnswerKeyQuestion(updated);
  }

  async remove(
    quizId: string,
    questionId: string,
    organizationId: string,
  ): Promise<void> {
    const quiz = await this.requireDraft(quizId, organizationId);
    const existing = await this.questionRepository.findByIdInQuiz(
      questionId,
      quiz.id,
    );
    if (!existing) {
      throw new NotFoundException('Question not found');
    }
    await this.transactionRunner.run(async (tx) => {
      await this.questionRepository.delete(questionId, tx);
      await this.quizRepository.recalculateTotalPoints(quiz.id, tx);
    });
  }

  /** Positions are rewritten from the given order, so a swap cannot collide. */
  async reorder(
    quizId: string,
    organizationId: string,
    questionIds: string[],
  ): Promise<AnswerKeyQuestionDto[]> {
    const quiz = await this.requireDraft(quizId, organizationId);
    const existing = await this.questionRepository.findManyWithAnswerKey(
      quiz.id,
    );
    const known = new Set(existing.map((question) => question.id));
    if (
      questionIds.length !== existing.length ||
      questionIds.some((id) => !known.has(id))
    ) {
      throw new NotFoundException(
        'The reorder list must contain every question in this quiz exactly once',
      );
    }

    await this.transactionRunner.run(async (tx) => {
      for (const [index, id] of questionIds.entries()) {
        await this.questionRepository.setPosition(id, index, tx);
      }
    });

    const reordered = await this.questionRepository.findManyWithAnswerKey(
      quiz.id,
    );
    return reordered.map(toAnswerKeyQuestion);
  }

  private async requireDraft(
    quizId: string,
    organizationId: string,
  ): Promise<Quiz> {
    const quiz = await this.quizzesService.requireQuiz(quizId, organizationId);
    this.quizPolicy.assertContentEditable(quiz);
    return quiz;
  }

  private validateContent(
    prompt: string | undefined,
    options: { text: string }[] | undefined,
    contentFormat: ContentFormat,
  ): void {
    if (prompt !== undefined) {
      assertValidContent(prompt, contentFormat, 'prompt');
    }
    options?.forEach((option, index) => {
      assertValidContent(option.text, contentFormat, `options[${index}].text`);
    });
  }
}
