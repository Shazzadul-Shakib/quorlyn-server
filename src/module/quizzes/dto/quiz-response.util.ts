import { Quiz } from '@prisma/client';
import { QuizResponseDto } from './quiz-response.dto';

export function toQuizResponse(
  quiz: Quiz,
  questionCount: number,
): QuizResponseDto {
  return {
    id: quiz.id,
    organizationId: quiz.organizationId,
    createdById: quiz.createdById,
    title: quiz.title,
    description: quiz.description,
    language: quiz.language,
    subject: quiz.subject,
    status: quiz.status,
    durationSeconds: quiz.durationSeconds,
    opensAt: quiz.opensAt,
    closesAt: quiz.closesAt,
    maxAttempts: quiz.maxAttempts,
    scoringPolicy: quiz.scoringPolicy,
    lateStartCutoff: quiz.lateStartCutoff,
    shuffleQuestions: quiz.shuffleQuestions,
    maxFocusViolations: quiz.maxFocusViolations,
    leaderboardVisibleToStudents: quiz.leaderboardVisibleToStudents,
    totalPoints: quiz.totalPoints,
    questionCount,
    publishedAt: quiz.publishedAt,
    closedAt: quiz.closedAt,
    createdAt: quiz.createdAt,
  };
}
