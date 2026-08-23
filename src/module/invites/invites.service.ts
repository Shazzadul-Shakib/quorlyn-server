import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Invite,
  InviteStatus,
  MembershipStatus,
  OrgRole,
  Permission,
} from '@prisma/client';
import { UserRepository } from '../../common/repositories/user.repository';
import { InviteRepository } from '../../common/repositories/invite.repository';
import { MembershipRepository } from '../../common/repositories/membership.repository';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { PrismaTransactionRunner } from '../../common/prisma/transaction-runner';
import { MAILER } from '../../common/mailer/mailer.interface';
import type { MailerService } from '../../common/mailer/mailer.interface';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { SessionService } from '../../common/session/session.service';
import type { StartSessionContext } from '../../common/session/session.service';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import {
  comparePassword,
  hashPassword,
} from '../../common/utils/password.util';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CreateInviteBatchDto } from './dto/create-invite-batch.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import { toInviteResponse } from './dto/invite-response.util';
import { InvitePreviewResponseDto } from './dto/invite-preview-response.dto';
import {
  BatchInviteOutcome,
  BatchInviteResponseDto,
  BatchInviteResultDto,
} from './dto/invite-batch-response.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TEACHER_PERMISSIONS: Permission[] = [
  Permission.MANAGE_QUIZZES,
  Permission.VIEW_RESULTS,
];

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly inviteRepository: InviteRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly transactionRunner: PrismaTransactionRunner,
    private readonly sessionService: SessionService,
    @Inject(MAILER) private readonly mailer: MailerService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createInvite(
    dto: CreateInviteDto,
    organizationId: string,
    invitedById: string,
  ): Promise<InviteResponseDto> {
    const email = normalizeEmail(dto.email);
    const outcome = await this.classify(email, organizationId);
    if (outcome === BatchInviteOutcome.ALREADY_MEMBER) {
      throw new ConflictException(
        'This email is already a member of this organization',
      );
    }
    if (outcome === BatchInviteOutcome.ALREADY_INVITED) {
      throw new ConflictException(
        'This email already has a pending invite for this organization',
      );
    }

    const organization = await this.requireOrganization(organizationId);
    const rawToken = generateOpaqueToken();
    const invite = await this.inviteRepository.create({
      email,
      ...this.grantFor(dto.role, dto.isOrgOwner, dto.permissions),
      organizationId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(this.clock.now().getTime() + INVITE_TTL_MS),
      invitedById,
    });

    await this.sendInviteEmail(invite, rawToken, organization.name);
    return toInviteResponse(invite);
  }

  /**
   * One row and one token per recipient (ADR-0009): a shared link could not be
   * attributed to a person or revoked for one of them.
   */
  async createBatch(
    dto: CreateInviteBatchDto,
    organizationId: string,
    invitedById: string,
  ): Promise<BatchInviteResponseDto> {
    const organization = await this.requireOrganization(organizationId);
    const emails = [...new Set(dto.emails.map(normalizeEmail))];

    const [existingMembers, pendingInvites] = await Promise.all([
      this.membershipRepository.findManyByOrgWithUser(
        organizationId,
        undefined,
        1000,
      ),
      this.inviteRepository.findPendingByEmailsAndOrg(emails, organizationId),
    ]);
    const memberEmails = new Set(
      existingMembers.map((membership) => membership.user.email),
    );
    const invitedEmails = new Map(
      pendingInvites.map((invite) => [invite.email, invite.id]),
    );

    const grant = this.grantFor(dto.role, dto.isOrgOwner, dto.permissions);
    const expiresAt = new Date(this.clock.now().getTime() + INVITE_TTL_MS);

    const results: BatchInviteResultDto[] = [];
    const toCreate: { email: string; rawToken: string }[] = [];

    for (const email of emails) {
      if (memberEmails.has(email)) {
        results.push({
          email,
          status: BatchInviteOutcome.ALREADY_MEMBER,
          inviteId: null,
        });
        continue;
      }
      const pendingId = invitedEmails.get(email);
      if (pendingId) {
        results.push({
          email,
          status: BatchInviteOutcome.ALREADY_INVITED,
          inviteId: pendingId,
        });
        continue;
      }
      toCreate.push({ email, rawToken: generateOpaqueToken() });
    }

    // Rows commit together; mail is sent afterwards so one dead mailbox
    // cannot roll back the other 99 invitations.
    const created = toCreate.length
      ? await this.inviteRepository.createMany(
          toCreate.map(({ email, rawToken }) => ({
            email,
            ...grant,
            organizationId,
            tokenHash: hashToken(rawToken),
            expiresAt,
            invitedById,
          })),
        )
      : [];

    const tokenByEmail = new Map(
      toCreate.map(({ email, rawToken }) => [email, rawToken]),
    );
    for (const invite of created) {
      results.push({
        email: invite.email,
        status: BatchInviteOutcome.INVITED,
        inviteId: invite.id,
      });
      await this.sendInviteEmail(
        invite,
        tokenByEmail.get(invite.email) ?? '',
        organization.name,
      );
    }

    return {
      created: created.length,
      skipped: results.length - created.length,
      results,
    };
  }

  async listForOrg(
    organizationId: string,
    status: InviteStatus | undefined,
    take: number,
    skip: number,
  ): Promise<InviteResponseDto[]> {
    const invites = await this.inviteRepository.findManyByOrg(
      organizationId,
      status,
      take,
      skip,
    );
    return invites.map(toInviteResponse);
  }

  async revoke(id: string, organizationId: string): Promise<void> {
    const invite = await this.inviteRepository.findByIdAndOrg(
      id,
      organizationId,
    );
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new ConflictException('Only pending invites can be revoked');
    }
    await this.inviteRepository.updateStatus(id, InviteStatus.REVOKED);
  }

  async previewByToken(rawToken: string): Promise<InvitePreviewResponseDto> {
    const invite = await this.findPendingInviteByToken(rawToken);
    const organization = await this.requireOrganization(invite.organizationId);
    const existingUser = await this.userRepository.findByEmail(invite.email);
    return {
      organizationName: organization.name,
      email: invite.email,
      role: invite.role,
      isOrgOwner: invite.isOrgOwner,
      expiresAt: invite.expiresAt,
      accountExists: existingUser !== null,
    };
  }

  /**
   * Accepting adds a membership. If the email already has an account the
   * password authenticates it, so one person can hold memberships in several
   * organizations under one login (ADR-0006).
   */
  async acceptInvite(
    rawToken: string,
    password: string,
    context: StartSessionContext,
  ): Promise<AuthTokensResponseDto> {
    const invite = await this.findPendingInviteByToken(rawToken);
    const existingUser = await this.userRepository.findByEmail(invite.email);

    if (existingUser) {
      const matches = await comparePassword(
        password,
        existingUser.passwordHash,
      );
      if (!matches || !existingUser.isActive) {
        throw new UnauthorizedException(
          'This email already has an account; sign in with its password to accept',
        );
      }
      const existingMembership =
        await this.membershipRepository.findByUserAndOrg(
          existingUser.id,
          invite.organizationId,
        );
      if (existingMembership) {
        throw new ConflictException(
          'You are already a member of this organization',
        );
      }
    }

    const passwordHash = existingUser
      ? existingUser.passwordHash
      : await hashPassword(password);

    const user = await this.transactionRunner.run(async (tx) => {
      const account =
        existingUser ??
        (await this.userRepository.create(
          {
            email: invite.email,
            passwordHash,
            // Students are device-locked, teachers are not (ADR-0017).
            singleDeviceEnforced: invite.role === OrgRole.STUDENT,
          },
          tx,
        ));

      await this.membershipRepository.create(
        {
          userId: account.id,
          organizationId: invite.organizationId,
          role: invite.role,
          isOrgOwner: invite.isOrgOwner,
          permissions: invite.permissions,
        },
        tx,
      );
      await this.inviteRepository.markAccepted(invite.id, tx);
      return account;
    });

    return this.sessionService.start(user, {
      ...context,
      preferredOrganizationId: invite.organizationId,
    });
  }

  private grantFor(
    role: OrgRole,
    isOrgOwner: boolean | undefined,
    permissions: Permission[] | undefined,
  ): { role: OrgRole; isOrgOwner: boolean; permissions: Permission[] } {
    if (role === OrgRole.STUDENT) {
      return { role, isOrgOwner: false, permissions: [] };
    }
    return {
      role,
      isOrgOwner: Boolean(isOrgOwner),
      permissions: permissions ?? DEFAULT_TEACHER_PERMISSIONS,
    };
  }

  private async classify(
    email: string,
    organizationId: string,
  ): Promise<BatchInviteOutcome> {
    const user = await this.userRepository.findByEmail(email);
    if (user) {
      const membership = await this.membershipRepository.findByUserAndOrg(
        user.id,
        organizationId,
      );
      if (membership && membership.status === MembershipStatus.ACTIVE) {
        return BatchInviteOutcome.ALREADY_MEMBER;
      }
    }
    const pending = await this.inviteRepository.findPendingByEmailAndOrg(
      email,
      organizationId,
    );
    return pending
      ? BatchInviteOutcome.ALREADY_INVITED
      : BatchInviteOutcome.INVITED;
  }

  private async sendInviteEmail(
    invite: Invite,
    rawToken: string,
    organizationName: string,
  ): Promise<void> {
    try {
      await this.mailer.sendInviteEmail({
        to: invite.email,
        inviteToken: rawToken,
        organizationName,
        role: invite.role,
        isOrgOwner: invite.isOrgOwner,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send invite email for invite ${invite.id}: ${String(error)}`,
      );
    }
  }

  private async findPendingInviteByToken(rawToken: string): Promise<Invite> {
    const invite = await this.inviteRepository.findByTokenHash(
      hashToken(rawToken),
    );
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new GoneException('This invite is no longer valid');
    }
    if (invite.expiresAt < this.clock.now()) {
      throw new GoneException('This invite has expired');
    }
    return invite;
  }

  private async requireOrganization(id: string) {
    const organization = await this.organizationRepository.findById(id);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
