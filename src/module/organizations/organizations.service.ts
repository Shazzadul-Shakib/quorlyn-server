import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Organization, OrgRole, PlatformRole } from '@prisma/client';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { InviteRepository } from '../../common/repositories/invite.repository';
import { UniqueConstraintViolationError } from '../../common/repositories/errors';
import { PrismaTransactionRunner } from '../../common/prisma/transaction-runner';
import { MAILER } from '../../common/mailer/mailer.interface';
import type { MailerService } from '../../common/mailer/mailer.interface';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { generateJoinCode } from '../../common/utils/join-code.util';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import { AuthenticatedUser } from '../../common/token/jwt-payload.interface';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { toOrganizationResponse } from './dto/organization-response.util';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_JOIN_CODE_ATTEMPTS = 5;

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly inviteRepository: InviteRepository,
    private readonly transactionRunner: PrismaTransactionRunner,
    @Inject(MAILER) private readonly mailer: MailerService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(dto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
    let result:
      { organization: Organization; rawInviteToken: string } | undefined;

    for (let attempt = 1; attempt <= MAX_JOIN_CODE_ATTEMPTS; attempt++) {
      try {
        result = await this.transactionRunner.run(async (tx) => {
          const organization = await this.organizationRepository.create(
            { name: dto.name, joinCode: generateJoinCode() },
            tx,
          );

          const rawInviteToken = generateOpaqueToken();
          await this.inviteRepository.create(
            {
              email: dto.ownerEmail,
              role: OrgRole.TEACHER,
              organizationId: organization.id,
              isOrgOwner: true,
              permissions: [],
              tokenHash: hashToken(rawInviteToken),
              expiresAt: new Date(this.clock.now().getTime() + INVITE_TTL_MS),
            },
            tx,
          );

          return { organization, rawInviteToken };
        });
        break;
      } catch (error) {
        if (
          error instanceof UniqueConstraintViolationError &&
          error.violates('joinCode') &&
          attempt < MAX_JOIN_CODE_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!result) {
      throw new ConflictException(
        'Could not allocate a unique join code, please retry',
      );
    }

    const { organization, rawInviteToken } = result;
    try {
      await this.mailer.sendInviteEmail({
        to: dto.ownerEmail,
        inviteToken: rawInviteToken,
        organizationName: organization.name,
        role: OrgRole.TEACHER,
        isOrgOwner: true,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send owner invite email for org ${organization.id}: ${String(error)}`,
      );
    }

    return toOrganizationResponse(organization);
  }

  async list(
    take: number,
    skip: number,
  ): Promise<{ items: OrganizationResponseDto[]; total: number }> {
    const [organizations, total] = await Promise.all([
      this.organizationRepository.findAll(take, skip),
      this.organizationRepository.count(),
    ]);
    return { items: organizations.map(toOrganizationResponse), total };
  }

  async findById(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    if (
      currentUser.platformRole !== PlatformRole.SUPERADMIN &&
      currentUser.org?.id !== id
    ) {
      throw new ForbiddenException('Cannot access another organization');
    }
    return toOrganizationResponse(await this.requireOrganization(id));
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    await this.requireOrganization(id);
    const organization = await this.organizationRepository.update(id, {
      name: dto.name,
    });
    return toOrganizationResponse(organization);
  }

  /**
   * Platform-level kill switch (superadmin only). Existing sessions inside
   * this org stop working within one access-token lifetime, the same way a
   * suspended Membership already does — see OrgClaimService.resolveOrThrow.
   */
  async setActive(
    id: string,
    isActive: boolean,
  ): Promise<OrganizationResponseDto> {
    await this.requireOrganization(id);
    const organization = await this.organizationRepository.setActive(
      id,
      isActive,
    );
    return toOrganizationResponse(organization);
  }

  /** Invalidates a leaked join code without disturbing existing members. */
  async rotateJoinCode(id: string): Promise<OrganizationResponseDto> {
    await this.requireOrganization(id);
    for (let attempt = 1; attempt <= MAX_JOIN_CODE_ATTEMPTS; attempt++) {
      try {
        const organization = await this.organizationRepository.updateJoinCode(
          id,
          generateJoinCode(),
        );
        return toOrganizationResponse(organization);
      } catch (error) {
        if (
          error instanceof UniqueConstraintViolationError &&
          error.violates('joinCode') &&
          attempt < MAX_JOIN_CODE_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a unique join code');
  }

  private async requireOrganization(id: string): Promise<Organization> {
    const organization = await this.organizationRepository.findById(id);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }
}
