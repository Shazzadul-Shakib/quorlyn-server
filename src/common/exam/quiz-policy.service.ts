import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
} from '@nestjs/common';
import { Quiz, QuestionType, QuizStatus } from '@prisma/client';
import { QuestionWithAnswerKey } from '../repositories/question.repository';

export interface StartWindow {
  deadlineAt: Date;
}

/**
 * All the rules about when a quiz may be edited, published, or sat
 * (ADR-0010, ADR-0012). Kept out of the services so the same rule cannot be
 * spelled two different ways on two code paths.
 */
@Injectable()
export class QuizPolicyService {
  assertContentEditable(quiz: Quiz): void {
    if (quiz.status !== QuizStatus.DRAFT) {
      throw new ConflictException(
        'Published quizzes are immutable; duplicate it to make a new version',
      );
    }
  }

  /** Fields that change neither what was asked nor how it was scored. */
  assertSettingsEditable(quiz: Quiz, fields: string[]): void {
    if (quiz.status === QuizStatus.DRAFT) {
      return;
    }
    const allowedAfterPublish = new Set([
      'title',
      'description',
      'opensAt',
      'closesAt',
      'leaderboardVisibleToStudents',
      'maxFocusViolations',
    ]);
    const frozen = fields.filter((field) => !allowedAfterPublish.has(field));
    if (frozen.length > 0) {
      throw new ConflictException(
        `Cannot change ${frozen.join(', ')} after publication (ADR-0010)`,
      );
    }
  }

  assertPublishable(quiz: Quiz, questions: QuestionWithAnswerKey[]): void {
    if (questions.length === 0) {
      throw new BadRequestException('A quiz needs at least one question');
    }
    for (const question of questions) {
      const correct = question.options.filter((option) => option.isCorrect);
      if (question.options.length < 2) {
        throw new BadRequestException(
          `Question ${question.position + 1} needs at least two options`,
        );
      }
      if (question.type !== QuestionType.MULTI_CHOICE && correct.length !== 1) {
        throw new BadRequestException(
          `Question ${question.position + 1} must have exactly one correct option`,
        );
      }
      if (question.type === QuestionType.MULTI_CHOICE && correct.length < 1) {
        throw new BadRequestException(
          `Question ${question.position + 1} must have at least one correct option`,
        );
      }
      if (
        question.type === QuestionType.TRUE_FALSE &&
        question.options.length !== 2
      ) {
        throw new BadRequestException(
          `Question ${question.position + 1} is true/false and must have exactly two options`,
        );
      }
    }
    if (quiz.opensAt && quiz.closesAt && quiz.closesAt <= quiz.opensAt) {
      throw new BadRequestException('closesAt must be after opensAt');
    }
    if (
      quiz.closesAt &&
      quiz.opensAt &&
      quiz.lateStartCutoff &&
      quiz.closesAt.getTime() - quiz.opensAt.getTime() <
        quiz.durationSeconds * 1000
    ) {
      throw new BadRequestException(
        'The availability window is shorter than one sitting; nobody could complete it',
      );
    }
  }

  /**
   * Eligibility to *start* a new sitting, and the deadline that sitting gets.
   * The deadline is min(now + duration, closesAt) — a window that closes does
   * not keep accepting answers (ADR-0012).
   */
  resolveStartWindow(quiz: Quiz, attemptsUsed: number, now: Date): StartWindow {
    if (quiz.status !== QuizStatus.PUBLISHED) {
      throw new ConflictException('This quiz is not open for attempts');
    }
    if (quiz.opensAt && now < quiz.opensAt) {
      throw new ConflictException('This quiz has not opened yet');
    }
    if (quiz.closesAt && now >= quiz.closesAt) {
      throw new GoneException('This quiz has closed');
    }
    if (attemptsUsed >= quiz.maxAttempts) {
      throw new ForbiddenException(
        `You have used all ${quiz.maxAttempts} attempt(s) for this quiz`,
      );
    }

    const fullDurationEnd = new Date(
      now.getTime() + quiz.durationSeconds * 1000,
    );
    const deadlineAt =
      quiz.closesAt && quiz.closesAt < fullDurationEnd
        ? quiz.closesAt
        : fullDurationEnd;

    if (quiz.lateStartCutoff && deadlineAt < fullDurationEnd) {
      throw new GoneException(
        'Too late to start: less than the full duration remains before this quiz closes',
      );
    }
    return { deadlineAt };
  }

  /** Re-applied at finalization so a shortened window still cuts the sitting. */
  effectiveDeadline(quiz: Quiz, storedDeadline: Date): Date {
    return quiz.closesAt && quiz.closesAt < storedDeadline
      ? quiz.closesAt
      : storedDeadline;
  }
}
