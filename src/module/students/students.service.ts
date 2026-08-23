import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { UserRepository } from '../../common/repositories/user.repository';
import { MembershipRepository } from '../../common/repositories/membership.repository';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { SessionService } from '../../common/session/session.service';
import type { StartSessionContext } from '../../common/session/session.service';
import {
  comparePassword,
  hashPassword,
} from '../../common/utils/password.util';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { JoinOrganizationDto } from './dto/join-organization.dto';

@Injectable()
export class StudentsService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Self-serve enrolment by join code (ADR-0003). With multi-org membership
   * an existing account simply gains another membership, which is what lets
   * one student sit exams at several organizations (ADR-0006).
   */
  async join(
    dto: JoinOrganizationDto,
    context: StartSessionContext,
  ): Promise<AuthTokensResponseDto> {
    const organization = await this.organizationRepository.findByJoinCode(
      dto.joinCode.trim().toUpperCase(),
    );
    if (!organization) {
      throw new NotFoundException('Invalid join code');
    }

    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.userRepository.findByEmail(email);

    if (existingUser) {
      const matches = await comparePassword(
        dto.password,
        existingUser.passwordHash,
      );
      if (!matches || !existingUser.isActive) {
        throw new UnauthorizedException(
          'This email already has an account; sign in with its password to join',
        );
      }
      const membership = await this.membershipRepository.findByUserAndOrg(
        existingUser.id,
        organization.id,
      );
      if (membership) {
        throw new ConflictException(
          'You are already a member of this organization',
        );
      }
      await this.membershipRepository.create({
        userId: existingUser.id,
        organizationId: organization.id,
        role: OrgRole.STUDENT,
      });
      return this.sessionService.start(existingUser, {
        ...context,
        preferredOrganizationId: organization.id,
      });
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.userRepository.create({
      email,
      passwordHash,
      singleDeviceEnforced: true,
    });
    await this.membershipRepository.create({
      userId: user.id,
      organizationId: organization.id,
      role: OrgRole.STUDENT,
    });

    return this.sessionService.start(user, {
      ...context,
      preferredOrganizationId: organization.id,
    });
  }
}
