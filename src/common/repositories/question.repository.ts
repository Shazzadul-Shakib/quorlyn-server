import { Injectable } from '@nestjs/common';
import {
  ContentFormat,
  Prisma,
  Question,
  QuestionOption,
  QuestionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateQuestionOptionInput {
  text: string;
  isCorrect: boolean;
}

export interface CreateQuestionInput {
  quizId: string;
  type: QuestionType;
  prompt: string;
  contentFormat: ContentFormat;
  points: number;
  position: number;
  options: CreateQuestionOptionInput[];
}

export type QuestionWithAnswerKey = Question & { options: QuestionOption[] };

/** The student-facing shape: `isCorrect` is not selected, so it is never loaded. */
export type ExamQuestion = Pick<
  Question,
  'id' | 'type' | 'prompt' | 'contentFormat' | 'points' | 'position'
> & {
  options: Pick<QuestionOption, 'id' | 'text' | 'position'>[];
};

@Injectable()
export class QuestionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: CreateQuestionInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<QuestionWithAnswerKey> {
    const { options, ...question } = data;
    return tx.question.create({
      data: {
        ...question,
        options: {
          create: options.map((option, index) => ({
            text: option.text,
            isCorrect: option.isCorrect,
            position: index,
          })),
        },
      },
      include: { options: { orderBy: { position: 'asc' } } },
    });
  }

  /**
   * Student-facing read (ADR-0011): the answer key is excluded by the
   * `select`, so it never reaches memory on this path.
   */
  findManyForExam(quizId: string): Promise<ExamQuestion[]> {
    return this.prisma.question.findMany({
      where: { quizId },
      select: {
        id: true,
        type: true,
        prompt: true,
        contentFormat: true,
        points: true,
        position: true,
        options: {
          select: { id: true, text: true, position: true },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { position: 'asc' },
    });
  }

  /** Student-facing single read, still without the answer key. */
  findByIdInQuizForExam(
    id: string,
    quizId: string,
  ): Promise<ExamQuestion | null> {
    return this.prisma.question.findFirst({
      where: { id, quizId },
      select: {
        id: true,
        type: true,
        prompt: true,
        contentFormat: true,
        points: true,
        position: true,
        options: {
          select: { id: true, text: true, position: true },
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  /** Teacher-facing / grading read: includes `isCorrect`. */
  findManyWithAnswerKey(quizId: string): Promise<QuestionWithAnswerKey[]> {
    return this.prisma.question.findMany({
      where: { quizId },
      include: { options: { orderBy: { position: 'asc' } } },
      orderBy: { position: 'asc' },
    });
  }

  findByIdInQuiz(
    id: string,
    quizId: string,
  ): Promise<QuestionWithAnswerKey | null> {
    return this.prisma.question.findFirst({
      where: { id, quizId },
      include: { options: { orderBy: { position: 'asc' } } },
    });
  }

  countByQuiz(quizId: string): Promise<number> {
    return this.prisma.question.count({ where: { quizId } });
  }

  async maxPosition(
    quizId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const aggregate = await tx.question.aggregate({
      where: { quizId },
      _max: { position: true },
    });
    return aggregate._max.position ?? -1;
  }

  /** Replacing options wholesale keeps option ids honest: a changed answer set is a new set. */
  async update(
    id: string,
    data: {
      type?: QuestionType;
      prompt?: string;
      contentFormat?: ContentFormat;
      points?: number;
      position?: number;
      options?: CreateQuestionOptionInput[];
    },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<QuestionWithAnswerKey> {
    const { options, ...scalars } = data;
    return tx.question.update({
      where: { id },
      data: {
        ...scalars,
        ...(options
          ? {
              options: {
                deleteMany: {},
                create: options.map((option, index) => ({
                  text: option.text,
                  isCorrect: option.isCorrect,
                  position: index,
                })),
              },
            }
          : {}),
      },
      include: { options: { orderBy: { position: 'asc' } } },
    });
  }

  async delete(
    id: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.question.delete({ where: { id } });
  }

  async setPosition(
    id: string,
    position: number,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.question.update({ where: { id }, data: { position } });
  }
}
