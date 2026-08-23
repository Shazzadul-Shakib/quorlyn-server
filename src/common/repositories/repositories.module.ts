import { Global, Module } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { MembershipRepository } from './membership.repository';
import { OrganizationRepository } from './organization.repository';
import { InviteRepository } from './invite.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { DeviceRepository } from './device.repository';
import { EmailChallengeRepository } from './email-challenge.repository';
import { QuizRepository } from './quiz.repository';
import { QuestionRepository } from './question.repository';
import { QuizLinkRepository } from './quiz-link.repository';
import { AttemptRepository } from './attempt.repository';
import { AttemptAnswerRepository } from './attempt-answer.repository';
import { ProctorEventRepository } from './proctor-event.repository';

const repositories = [
  UserRepository,
  MembershipRepository,
  OrganizationRepository,
  InviteRepository,
  RefreshTokenRepository,
  DeviceRepository,
  EmailChallengeRepository,
  QuizRepository,
  QuestionRepository,
  QuizLinkRepository,
  AttemptRepository,
  AttemptAnswerRepository,
  ProctorEventRepository,
];

@Global()
@Module({
  providers: repositories,
  exports: repositories,
})
export class RepositoriesModule {}
