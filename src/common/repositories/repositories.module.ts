import { Global, Module } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { OrganizationRepository } from './organization.repository';
import { InviteRepository } from './invite.repository';
import { RefreshTokenRepository } from './refresh-token.repository';

@Global()
@Module({
  providers: [
    UserRepository,
    OrganizationRepository,
    InviteRepository,
    RefreshTokenRepository,
  ],
  exports: [
    UserRepository,
    OrganizationRepository,
    InviteRepository,
    RefreshTokenRepository,
  ],
})
export class RepositoriesModule {}
