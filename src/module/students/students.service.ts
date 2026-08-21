import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UserRepository } from '../../common/repositories/user.repository';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { UniqueConstraintViolationError } from '../../common/repositories/errors';
import { TokenService } from '../../common/token/token.service';
import { hashPassword } from '../../common/utils/password.util';
import { toUserSummary } from '../../common/utils/user-summary.util';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { JoinOrganizationDto } from './dto/join-organization.dto';

@Injectable()
export class StudentsService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly tokenService: TokenService,
  ) {}

  async join(dto: JoinOrganizationDto): Promise<AuthTokensResponseDto> {
    const organization = await this.organizationRepository.findByJoinCode(
      dto.joinCode.trim().toUpperCase(),
    );
    if (!organization) {
      throw new NotFoundException('Invalid join code');
    }

    const passwordHash = await hashPassword(dto.password);

    try {
      const user = await this.userRepository.create({
        email: dto.email,
        passwordHash,
        role: Role.STUDENT,
        organizationId: organization.id,
        isOrgOwner: false,
      });
      const tokens = await this.tokenService.issueTokenPair(user);
      return { ...tokens, user: toUserSummary(user) };
    } catch (error) {
      if (
        error instanceof UniqueConstraintViolationError &&
        error.violates('email')
      ) {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }
}
