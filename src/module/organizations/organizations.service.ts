import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Organization, Role } from '@prisma/client';
import { UserRepository } from '../../common/repositories/user.repository';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { InviteRepository } from '../../common/repositories/invite.repository';
import { UniqueConstraintViolationError } from '../../common/repositories/errors';
import { PrismaTransactionRunner } from '../../common/prisma/transaction-runner';
import { MAILER } from '../../common/mailer/mailer.interface';
import type { MailerService } from '../../common/mailer/mailer.interface';
import { generateJoinCode } from '../../common/utils/join-code.util';
import { generateOpaqueToken, hashToken } from '../../common/utils/token.util';
import { AuthenticatedUser } from '../../common/token/jwt-payload.interface';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { toOrganizationResponse } from './dto/organization-response.util';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_JOIN_CODE_ATTEMPTS = 5;

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly inviteRepository: InviteRepository,
    private readonly transactionRunner: PrismaTransactionRunner,
    @Inject(MAILER) private readonly mailer: MailerService,
  ) {}

  async create(dto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
    const existingUser = await this.userRepository.findByEmail(dto.ownerEmail);
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

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
              role: Role.TEACHER,
              organizationId: organization.id,
              isOrgOwner: true,
              tokenHash: hashToken(rawInviteToken),
              expiresAt: new Date(Date.now() + INVITE_TTL_MS),
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
        role: Role.TEACHER,
        isOrgOwner: true,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send owner invite email for org ${organization.id}: ${String(error)}`,
      );
    }

    return toOrganizationResponse(organization);
  }

  async list(): Promise<OrganizationResponseDto[]> {
    const organizations = await this.organizationRepository.findAll();
    return organizations.map(toOrganizationResponse);
  }

  async findById(
    id: string,
    currentUser: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    if (
      currentUser.role !== Role.SUPERADMIN &&
      currentUser.organizationId !== id
    ) {
      throw new ForbiddenException('Cannot access another organization');
    }

    const organization = await this.organizationRepository.findById(id);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return toOrganizationResponse(organization);
  }
}
