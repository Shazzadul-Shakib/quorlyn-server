import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './common/config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { RepositoriesModule } from './common/repositories/repositories.module';
import { ClockModule } from './common/clock/clock.module';
import { MailerModule } from './common/mailer/mailer.module';
import { TokenModule } from './common/token/token.module';
import { SessionModule } from './common/session/session.module';
import { ExamModule } from './common/exam/exam.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PlatformRolesGuard } from './common/guards/platform-roles.guard';
import { OrgContextGuard } from './common/guards/org-context.guard';
import { OrgRolesGuard } from './common/guards/org-roles.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

import { AuthModule } from './module/auth/auth.module';
import { OrganizationsModule } from './module/organizations/organizations.module';
import { InvitesModule } from './module/invites/invites.module';
import { StudentsModule } from './module/students/students.module';
import { QuizzesModule } from './module/quizzes/quizzes.module';
import { AttemptsModule } from './module/attempts/attempts.module';
import { DashboardModule } from './module/dashboard/dashboard.module';
import { AdminModule } from './module/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
    }),
    ScheduleModule.forRoot(),

    ClockModule,
    PrismaModule,
    RepositoriesModule,
    TokenModule,
    SessionModule,
    MailerModule,
    ExamModule,

    AuthModule,
    OrganizationsModule,
    InvitesModule,
    StudentsModule,
    QuizzesModule,
    AttemptsModule,
    DashboardModule,
    AdminModule,
  ],
  providers: [
    // Order matters: authenticate, then platform role, then organization
    // context, then org role, then fine-grained permissions (ADR-0007/0008).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PlatformRolesGuard },
    { provide: APP_GUARD, useClass: OrgContextGuard },
    { provide: APP_GUARD, useClass: OrgRolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
