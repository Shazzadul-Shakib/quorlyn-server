import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuizStatus, SubmissionCause } from '@prisma/client';

export class QuizOverviewDto {
  @ApiProperty() quizId: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: QuizStatus }) status: QuizStatus;
  @ApiProperty() totalPoints: number;
  @ApiProperty() attempts: number;
  @ApiProperty({ description: 'Distinct students with a submitted attempt' })
  students: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) averageScore:
    number | null;
}

export class TeacherDashboardDto {
  @ApiProperty() quizCount: number;
  @ApiProperty() publishedCount: number;
  @ApiProperty() draftCount: number;
  @ApiProperty() totalAttempts: number;
  @ApiProperty({ type: [QuizOverviewDto] }) quizzes: QuizOverviewDto[];
}

export class ScoreBucketDto {
  @ApiProperty({ description: 'Decile index 0-9' }) bucket: number;
  @ApiProperty() count: number;
}

export class QuestionDifficultyDto {
  @ApiProperty() questionId: string;
  @ApiProperty() position: number;
  @ApiProperty() prompt: string;
  @ApiProperty() answered: number;
  @ApiProperty() correct: number;
  @ApiProperty({ description: 'correct / answered, 0-1' }) correctRate: number;
}

export class SubmissionCauseCountDto {
  @ApiProperty({ enum: SubmissionCause }) cause: SubmissionCause;
  @ApiProperty() count: number;
}

export class QuizDashboardDto {
  @ApiProperty({ type: QuizOverviewDto }) quiz: QuizOverviewDto;
  @ApiProperty({
    description: 'Distinct students who started through a link or enrolment',
  })
  invitedStudents: number;
  @ApiProperty() completionRate: number;
  @ApiProperty({ type: [ScoreBucketDto] }) scoreDistribution: ScoreBucketDto[];
  @ApiProperty({ type: [QuestionDifficultyDto] })
  questionDifficulty: QuestionDifficultyDto[];
  @ApiProperty({ type: [SubmissionCauseCountDto] })
  submissionCauses: SubmissionCauseCountDto[];
}

export class OrganizationDashboardDto {
  @ApiProperty() organizationId: string;
  @ApiProperty() organizationName: string;
  @ApiProperty() teacherCount: number;
  @ApiProperty() studentCount: number;
  @ApiProperty() quizCount: number;
  @ApiProperty() publishedQuizCount: number;
  @ApiProperty({
    description: 'Attempts submitted inside the requested window',
  })
  attemptsInPeriod: number;
  @ApiProperty({ type: [QuizOverviewDto] }) recentQuizzes: QuizOverviewDto[];
}

export class StudentProgressEntryDto {
  @ApiProperty() organizationId: string;
  @ApiProperty() organizationName: string;
  @ApiProperty() quizId: string;
  @ApiProperty() quizTitle: string;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) bestScore:
    number | null;
  @ApiProperty() maxScore: number;
  @ApiPropertyOptional({ type: Date, nullable: true })
  lastAttemptAt: Date | null;
}

export class StudentDashboardDto {
  @ApiProperty() organizationCount: number;
  @ApiProperty() quizzesAttempted: number;
  @ApiProperty() attemptsSubmitted: number;
  @ApiProperty({ type: [StudentProgressEntryDto] })
  progress: StudentProgressEntryDto[];
}
