import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AttemptStatus, OrgRole, QuizStatus } from '@prisma/client';
import { AttemptRepository } from '../../common/repositories/attempt.repository';
import { AttemptAnswerRepository } from '../../common/repositories/attempt-answer.repository';
import { QuizRepository } from '../../common/repositories/quiz.repository';
import { QuestionRepository } from '../../common/repositories/question.repository';
import { MembershipRepository } from '../../common/repositories/membership.repository';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { AttemptFinalizerService } from '../../common/exam/attempt-finalizer.service';
import { CLOCK, type Clock } from '../../common/clock/clock';
import {
  OrganizationDashboardDto,
  QuizDashboardDto,
  QuizOverviewDto,
  StudentDashboardDto,
  TeacherDashboardDto,
  TeacherStatsDto,
} from './dto/dashboard-response.dto';
import { DEFAULT_PERIOD_DAYS, PeriodQueryDto } from './dto/period.query.dto';

const RECENT_QUIZ_LIMIT = 10;
const TEACHER_QUIZ_LIMIT = 50;
const TEACHER_STATS_LIMIT = 200;

/**
 * Every figure is aggregated on read (ADR-0019). No counters are maintained
 * on write, so nothing can drift out of agreement with the attempt tables.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly attemptRepository: AttemptRepository,
    private readonly attemptAnswerRepository: AttemptAnswerRepository,
    private readonly quizRepository: QuizRepository,
    private readonly questionRepository: QuestionRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly finalizer: AttemptFinalizerService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async forTeacher(
    organizationId: string,
    createdById: string,
    onlyMine: boolean,
  ): Promise<TeacherDashboardDto> {
    const filter = {
      organizationId,
      createdById: onlyMine ? createdById : undefined,
      take: TEACHER_QUIZ_LIMIT,
    };
    const quizzes = await this.quizRepository.findMany(filter);
    const overviews = await this.overviewsFor(quizzes);

    return {
      quizCount: quizzes.length,
      publishedCount: quizzes.filter(
        (quiz) => quiz.status === QuizStatus.PUBLISHED,
      ).length,
      draftCount: quizzes.filter((quiz) => quiz.status === QuizStatus.DRAFT)
        .length,
      totalAttempts: overviews.reduce(
        (total, overview) => total + overview.attempts,
        0,
      ),
      quizzes: overviews,
    };
  }

  async forQuiz(
    quizId: string,
    organizationId: string,
  ): Promise<QuizDashboardDto> {
    const quiz = await this.quizRepository.findByIdInOrg(
      quizId,
      organizationId,
    );
    if (!quiz) {
      throw new NotFoundException('Quiz not found');
    }

    // Settle anything still open so the numbers are not one sweep behind.
    const inFlight = await this.attemptRepository.findInProgressByQuiz(quizId);
    for (const attempt of inFlight) {
      await this.finalizer.finalizeIfDue(attempt, quiz);
    }

    const [overview] = await this.overviewsFor([quiz]);
    const [distribution, difficulty, causes, questions, studentCount] =
      await Promise.all([
        this.attemptRepository.scoreDistribution(quizId),
        this.attemptAnswerRepository.difficultyByQuiz(quizId),
        this.attemptRepository.causeBreakdown(quizId),
        this.questionRepository.findManyForExam(quizId),
        this.membershipRepository.countByOrg(organizationId, OrgRole.STUDENT),
      ]);

    const byQuestion = new Map(difficulty.map((row) => [row.questionId, row]));

    return {
      quiz: overview,
      invitedStudents: studentCount,
      completionRate:
        studentCount === 0 ? 0 : Math.min(1, overview.students / studentCount),
      scoreDistribution: distribution,
      questionDifficulty: questions.map((question) => {
        const counts = byQuestion.get(question.id) ?? {
          answered: 0,
          correct: 0,
        };
        return {
          questionId: question.id,
          position: question.position,
          prompt: question.prompt,
          answered: counts.answered,
          correct: counts.correct,
          correctRate:
            counts.answered === 0 ? 0 : counts.correct / counts.answered,
        };
      }),
      submissionCauses: causes,
    };
  }

  async forOrganization(
    organizationId: string,
    period: PeriodQueryDto,
  ): Promise<OrganizationDashboardDto> {
    const organization =
      await this.organizationRepository.findById(organizationId);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const { from, to } = this.resolvePeriod(period);
    const [
      teacherMemberships,
      students,
      quizCount,
      publishedCount,
      attemptsInPeriod,
    ] = await Promise.all([
      this.membershipRepository.findManyByOrgWithUser(
        organizationId,
        OrgRole.TEACHER,
        TEACHER_STATS_LIMIT,
      ),
      this.membershipRepository.countByOrg(organizationId, OrgRole.STUDENT),
      this.quizRepository.count({ organizationId }),
      this.quizRepository.count({
        organizationId,
        status: QuizStatus.PUBLISHED,
      }),
      this.attemptRepository.countSubmittedInPeriod(organizationId, from, to),
    ]);

    const [recent, teacherStats] = await Promise.all([
      this.quizRepository.findMany({
        organizationId,
        take: RECENT_QUIZ_LIMIT,
      }),
      this.teacherStatsFor(organizationId, teacherMemberships),
    ]);

    return {
      organizationId,
      organizationName: organization.name,
      teacherCount: teacherMemberships.length,
      studentCount: students,
      quizCount,
      publishedQuizCount: publishedCount,
      attemptsInPeriod,
      recentQuizzes: await this.overviewsFor(recent),
      teacherStats,
    };
  }

  /**
   * "Which teacher creates how many quizzes" for the owner's dashboard.
   * Reuses `forTeacher` per teacher rather than a new aggregate query — a
   * handful of memberships per organization, so the fan-out stays cheap and
   * the two views (a teacher's own dashboard vs. their row here) can never
   * disagree about what "their quizzes" counts.
   */
  private async teacherStatsFor(
    organizationId: string,
    teachers: { userId: string; user: { email: string } }[],
  ): Promise<TeacherStatsDto[]> {
    const stats = await Promise.all(
      teachers.map(async (teacher) => {
        const dashboard = await this.forTeacher(
          organizationId,
          teacher.userId,
          true,
        );
        return {
          teacherId: teacher.userId,
          email: teacher.user.email,
          quizCount: dashboard.quizCount,
          publishedCount: dashboard.publishedCount,
          totalAttempts: dashboard.totalAttempts,
        };
      }),
    );
    return stats.sort((a, b) => b.quizCount - a.quizCount);
  }

  /**
   * The one cross-tenant read in the product, and it is safe only because it
   * is scoped to the caller's own userId (ADR-0019).
   */
  async forStudent(userId: string): Promise<StudentDashboardDto> {
    const [attempts, memberships] = await Promise.all([
      this.attemptRepository.findManyForUser(userId, { take: 100 }),
      this.membershipRepository.findManyByUserWithOrganization(userId),
    ]);

    for (const attempt of attempts) {
      await this.finalizer.finalizeIfDue(attempt, attempt.quiz);
    }

    const organizationNames = new Map(
      memberships.map((membership) => [
        membership.organizationId,
        membership.organization.name,
      ]),
    );

    const byQuiz = new Map<string, (typeof attempts)[number][]>();
    for (const attempt of attempts) {
      const list = byQuiz.get(attempt.quizId) ?? [];
      list.push(attempt);
      byQuiz.set(attempt.quizId, list);
    }

    const progress = [...byQuiz.entries()].map(([quizId, quizAttempts]) => {
      const submitted = quizAttempts.filter(
        (attempt) => attempt.status === AttemptStatus.SUBMITTED,
      );
      const scores = submitted
        .map((attempt) => attempt.score)
        .filter((score): score is number => score !== null);
      const lastAttempt = quizAttempts
        .map((attempt) => attempt.submittedAt ?? attempt.startedAt)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        organizationId: quizAttempts[0].organizationId,
        organizationName:
          organizationNames.get(quizAttempts[0].organizationId) ?? 'Unknown',
        quizId,
        quizTitle: quizAttempts[0].quiz.title,
        attempts: quizAttempts.length,
        bestScore: scores.length > 0 ? Math.max(...scores) : null,
        maxScore: quizAttempts[0].maxScore,
        lastAttemptAt: lastAttempt ?? null,
      };
    });

    return {
      organizationCount: memberships.length,
      quizzesAttempted: byQuiz.size,
      attemptsSubmitted: attempts.filter(
        (attempt) => attempt.status === AttemptStatus.SUBMITTED,
      ).length,
      progress,
    };
  }

  private async overviewsFor(
    quizzes: {
      id: string;
      title: string;
      status: QuizStatus;
      totalPoints: number;
    }[],
  ): Promise<QuizOverviewDto[]> {
    const aggregates = await this.attemptRepository.aggregateByQuiz(
      quizzes.map((quiz) => quiz.id),
    );
    const byQuiz = new Map(
      aggregates.map((aggregate) => [aggregate.quizId, aggregate]),
    );

    return quizzes.map((quiz) => {
      const aggregate = byQuiz.get(quiz.id);
      return {
        quizId: quiz.id,
        title: quiz.title,
        status: quiz.status,
        totalPoints: quiz.totalPoints,
        attempts: aggregate?.attempts ?? 0,
        students: aggregate?.students ?? 0,
        averageScore: aggregate?.averageScore ?? null,
      };
    });
  }

  private resolvePeriod(period: PeriodQueryDto): { from: Date; to: Date } {
    const to = period.to ? new Date(period.to) : this.clock.now();
    const from = period.from
      ? new Date(period.from)
      : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    return { from, to };
  }
}
