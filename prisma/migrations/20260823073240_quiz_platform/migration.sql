-- Quiz & examination platform (ADR-0006 … ADR-0020).
--
-- NOT additive: tenancy moves off the User row onto Membership (ADR-0006).
-- Order matters — Membership is created and backfilled from
-- User.organizationId/role/isOrgOwner BEFORE those columns are dropped, so no
-- existing member is lost.

-- ============================================================== 1. new enums

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPERADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('MANAGE_MEMBERS', 'MANAGE_QUIZZES', 'VIEW_RESULTS', 'MANAGE_ORGANIZATION');

-- CreateEnum
CREATE TYPE "ChallengePurpose" AS ENUM ('DEVICE_CHANGE');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('PLAIN', 'LATEX_MIXED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'BN', 'MIXED');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTI_CHOICE', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "ScoringPolicy" AS ENUM ('BEST', 'FIRST', 'LATEST');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "SubmissionCause" AS ENUM ('MANUAL', 'TIMER_EXPIRED', 'DISCONNECTED', 'PROCTOR_VIOLATION', 'QUIZ_CLOSED', 'ADMIN_CLOSED');

-- CreateEnum
CREATE TYPE "ProctorEventType" AS ENUM ('TAB_HIDDEN', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'COPY', 'PASTE', 'RECONNECT', 'DEVICE_CHANGED');

-- ================================================== 2. Membership + backfill

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "isOrgOwner" BOOLEAN NOT NULL DEFAULT false,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissions" "Permission"[] DEFAULT ARRAY[]::"Permission"[],
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one membership per user that currently belongs to an organization.
-- Superadmins (organizationId IS NULL) get none, by design.
INSERT INTO "Membership" ("id", "userId", "organizationId", "role", "isOrgOwner", "status", "permissions", "joinedAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    u."id",
    u."organizationId",
    u."role"::text::"OrgRole",
    u."isOrgOwner",
    'ACTIVE'::"MembershipStatus",
    CASE
        WHEN u."role"::text = 'TEACHER'
            THEN ARRAY['MANAGE_QUIZZES', 'VIEW_RESULTS']::"Permission"[]
        ELSE ARRAY[]::"Permission"[]
    END,
    u."createdAt",
    CURRENT_TIMESTAMP
FROM "User" u
WHERE u."organizationId" IS NOT NULL
  AND u."role"::text IN ('TEACHER', 'STUDENT');

-- ========================= 3. User: platform role, then drop tenancy columns

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "platformRole" "PlatformRole" NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "singleDeviceEnforced" BOOLEAN NOT NULL DEFAULT true;

-- Superadmins are identified by platformRole from here on.
UPDATE "User" SET "platformRole" = 'SUPERADMIN' WHERE "role"::text = 'SUPERADMIN';

-- Teachers and superadmins are not device-locked; students are (ADR-0017).
UPDATE "User" SET "singleDeviceEnforced" = false WHERE "role"::text IN ('TEACHER', 'SUPERADMIN');

-- DropIndex
DROP INDEX "Invite_organizationId_idx";

-- DropIndex
DROP INDEX "User_organizationId_idx";

-- DropIndex
DROP INDEX "User_organizationId_role_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isOrgOwner",
DROP COLUMN "organizationId",
DROP COLUMN "role";

-- ========================== 4. Invite: cast role to OrgRole, preserving rows

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "permissions" "Permission"[] DEFAULT ARRAY[]::"Permission"[];

ALTER TABLE "Invite" ALTER COLUMN "role" TYPE "OrgRole" USING ("role"::text::"OrgRole");

-- DropEnum
DROP TYPE "Role";

-- =========================================== 5. quiz, attempt, device tables

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "deviceId" TEXT;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceIdHash" TEXT NOT NULL,
    "label" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "ChallengePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "language" "Language" NOT NULL DEFAULT 'MIXED',
    "subject" TEXT,
    "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT',
    "durationSeconds" INTEGER NOT NULL,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "scoringPolicy" "ScoringPolicy" NOT NULL DEFAULT 'BEST',
    "lateStartCutoff" BOOLEAN NOT NULL DEFAULT true,
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT true,
    "maxFocusViolations" INTEGER DEFAULT 3,
    "leaderboardVisibleToStudents" BOOLEAN NOT NULL DEFAULT false,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "contentFormat" "ContentFormat" NOT NULL DEFAULT 'LATEX_MIXED',
    "points" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizLink" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quizLinkId" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "submissionCause" "SubmissionCause",
    "score" INTEGER,
    "maxScore" INTEGER NOT NULL,
    "focusViolations" INTEGER NOT NULL DEFAULT 0,
    "deviceId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOptionIds" TEXT[],
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCorrect" BOOLEAN,
    "pointsAwarded" INTEGER,

    CONSTRAINT "AttemptAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" "ProctorEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ProctorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_deviceIdHash_key" ON "Device"("userId", "deviceIdHash");

-- CreateIndex
CREATE INDEX "EmailChallenge_userId_purpose_idx" ON "EmailChallenge"("userId", "purpose");

-- CreateIndex
CREATE INDEX "Quiz_organizationId_status_idx" ON "Quiz"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Quiz_createdById_idx" ON "Quiz"("createdById");

-- CreateIndex
CREATE INDEX "Question_quizId_position_idx" ON "Question"("quizId", "position");

-- CreateIndex
CREATE INDEX "QuestionOption_questionId_position_idx" ON "QuestionOption"("questionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuizLink_tokenHash_key" ON "QuizLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuizLink_quizId_idx" ON "QuizLink"("quizId");

-- CreateIndex
CREATE INDEX "Attempt_quizId_status_idx" ON "Attempt"("quizId", "status");

-- CreateIndex
CREATE INDEX "Attempt_userId_quizId_idx" ON "Attempt"("userId", "quizId");

-- CreateIndex
CREATE INDEX "Attempt_status_deadlineAt_idx" ON "Attempt"("status", "deadlineAt");

-- CreateIndex
CREATE INDEX "Attempt_organizationId_submittedAt_idx" ON "Attempt"("organizationId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_quizId_userId_attemptNumber_key" ON "Attempt"("quizId", "userId", "attemptNumber");

-- CreateIndex
CREATE INDEX "AttemptAnswer_attemptId_idx" ON "AttemptAnswer"("attemptId");

-- CreateIndex
CREATE INDEX "AttemptAnswer_questionId_isCorrect_idx" ON "AttemptAnswer"("questionId", "isCorrect");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptAnswer_attemptId_questionId_key" ON "AttemptAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "ProctorEvent_attemptId_type_idx" ON "ProctorEvent"("attemptId", "type");

-- CreateIndex
CREATE INDEX "Invite_organizationId_status_idx" ON "Invite"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RefreshToken_deviceId_idx" ON "RefreshToken"("deviceId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailChallenge" ADD CONSTRAINT "EmailChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizLink" ADD CONSTRAINT "QuizLink_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizLink" ADD CONSTRAINT "QuizLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_quizLinkId_fkey" FOREIGN KEY ("quizLinkId") REFERENCES "QuizLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorEvent" ADD CONSTRAINT "ProctorEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
