import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InviteStatus } from '@prisma/client';
import { UserRepository } from '../../common/repositories/user.repository';
import { InviteRepository } from '../../common/repositories/invite.repository';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { PrismaTransactionRunner } from '../../common/prisma/transaction-runner';
import { MAILER } from '../../common/mailer/mailer.interface';
import type { MailerService } from '../../common/mailer/mailer.interface';
import { TokenService } from '../../common/token/token.service';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import { hashPassword } from '../../common/utils/password.util';
import { toUserSummary } from '../../common/utils/user-summary.util';
import { CreateInviteDto, InvitableRole } from './dto/create-invite.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import { toInviteResponse } from './dto/invite-response.util';
import { InvitePreviewResponseDto } from './dto/invite-preview-response.dto';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly inviteRepository: InviteRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly transactionRunner: PrismaTransactionRunner,
    private readonly tokenService: TokenService,
    @Inject(MAILER) private readonly mailer: MailerService,
  ) {}

  async createInvite(
    dto: CreateInviteDto,
    organizationId: string,
    invitedById: string,
  ): Promise<InviteResponseDto> {
    const existingUser = await this.userRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    const existingPendingInvite =
      await this.inviteRepository.findPendingByEmailAndOrg(
        dto.email,
        organizationId,
      );
    if (existingPendingInvite) {
      throw new ConflictException(
        'This email already has a pending invite for this organization',
      );
    }

    const isOrgOwner =
      dto.role === InvitableRole.TEACHER ? Boolean(dto.isOrgOwner) : false;
    const rawToken = generateOpaqueToken();

    const invite = await this.inviteRepository.create({
      email: dto.email,
      role: dto.role,
      organizationId,
      isOrgOwner,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedById,
    });

    const organization =
      await this.organizationRepository.findById(organizationId);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    try {
      await this.mailer.sendInviteEmail({
        to: dto.email,
        inviteToken: rawToken,
        organizationName: organization.name,
        role: dto.role,
        isOrgOwner,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send invite email for invite ${invite.id}: ${String(error)}`,
      );
    }

    return toInviteResponse(invite);
  }

  async listForOrg(organizationId: string): Promise<InviteResponseDto[]> {
    const invites = await this.inviteRepository.findManyByOrg(organizationId);
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
    const organization = await this.organizationRepository.findById(
      invite.organizationId,
    );
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return {
      organizationName: organization.name,
      email: invite.email,
      role: invite.role,
      isOrgOwner: invite.isOrgOwner,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(
    rawToken: string,
    password: string,
  ): Promise<AuthTokensResponseDto> {
    const invite = await this.findPendingInviteByToken(rawToken);
    const passwordHash = await hashPassword(password);

    const user = await this.transactionRunner.run(async (tx) => {
      const createdUser = await this.userRepository.create(
        {
          email: invite.email,
          passwordHash,
          role: invite.role,
          organizationId: invite.organizationId,
          isOrgOwner: invite.isOrgOwner,
        },
        tx,
      );
      await this.inviteRepository.markAccepted(invite.id, tx);
      return createdUser;
    });

    const tokens = await this.tokenService.issueTokenPair(user);
    return { ...tokens, user: toUserSummary(user) };
  }

  private async findPendingInviteByToken(rawToken: string) {
    const invite = await this.inviteRepository.findByTokenHash(
      hashToken(rawToken),
    );
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== InviteStatus.PENDING) {
      throw new GoneException('This invite is no longer valid');
    }
    if (invite.expiresAt < new Date()) {
      throw new GoneException('This invite has expired');
    }
    return invite;
  }
}
