import { Module } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizLinksController } from './quiz-links.controller';
import { QuizzesService } from './quizzes.service';
import { QuestionsService } from './questions.service';
import { QuizLinksService } from './quiz-links.service';
import { QuizClosingSweeperService } from './quiz-closing-sweeper.service';
import { LeaderboardService } from './leaderboard.service';

@Module({
  controllers: [QuizzesController, QuizLinksController],
  providers: [
    QuizzesService,
    QuestionsService,
    QuizLinksService,
    QuizClosingSweeperService,
    LeaderboardService,
  ],
  exports: [QuizzesService],
})
export class QuizzesModule {}
