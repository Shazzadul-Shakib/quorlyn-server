import { ForbiddenException, Injectable } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { AttemptRepository } from '../../common/repositories/attempt.repository';
import { AttemptFinalizerService } from '../../common/exam/attempt-finalizer.service';
import { OrgClaim } from '../../common/token/jwt-payload.interface';
import { LeaderboardResponseDto } from './dto/leaderboard-response.dto';
import { QuizzesService } from './quizzes.service';

/** Students see the top N plus their own row — never the full roster. */
const STUDENT_VISIBLE_ENTRIES = 10;

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly attemptRepository: AttemptRepository,
    private readonly quizzesService: QuizzesService,
    private readonly finalizer: AttemptFinalizerService,
  ) {}

  async forQuiz(
    quizId: string,
    org: OrgClaim,
    userId: string,
    take: number,
    skip: number,
  ): Promise<LeaderboardResponseDto> {
    const quiz = await this.quizzesService.requireQuiz(quizId, org.id);

    if (org.role === OrgRole.STUDENT && !quiz.leaderboardVisibleToStudents) {
      throw new ForbiddenException(
        'The leaderboard for this quiz is not shared with students',
      );
    }

    // Settle anything the sweeper has not reached, so the board never shows a
    // student as missing because a job has not run yet (ADR-0015).
    const inFlight = await this.attemptRepository.findInProgressByQuiz(quizId);
    for (const attempt of inFlight) {
      await this.finalizer.finalizeIfDue(attempt, attempt.quiz);
    }

    const limit = org.role === OrgRole.STUDENT ? STUDENT_VISIBLE_ENTRIES : take;
    const offset = org.role === OrgRole.STUDENT ? 0 : skip;

    const [entries, me] = await Promise.all([
      this.attemptRepository.leaderboard(
        quizId,
        quiz.scoringPolicy,
        limit,
        offset,
      ),
      this.attemptRepository.leaderboardEntryForUser(
        quizId,
        quiz.scoringPolicy,
        userId,
      ),
    ]);

    return {
      quizId,
      scoringPolicy: quiz.scoringPolicy,
      entries,
      me,
    };
  }
}
