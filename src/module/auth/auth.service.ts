import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRepository } from '../../common/repositories/user.repository';
import {
  RefreshTokenMeta,
  TokenService,
} from '../../common/token/token.service';
import { comparePassword } from '../../common/utils/password.util';
import { toUserSummary } from '../../common/utils/user-summary.util';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { TokenPairResponseDto } from '../../common/dto/token-pair-response.dto';
import { UserSummaryDto } from '../../common/dto/user-summary.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly tokenService: TokenService,
  ) {}

  async login(
    email: string,
    password: string,
    meta: RefreshTokenMeta,
  ): Promise<AuthTokensResponseDto> {
    const user = await this.userRepository.findByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.tokenService.issueTokenPair(user, meta);
    return { ...tokens, user: toUserSummary(user) };
  }

  async refresh(
    rawRefreshToken: string,
    meta: RefreshTokenMeta,
  ): Promise<TokenPairResponseDto> {
    return this.tokenService.rotateRefreshToken(rawRefreshToken, meta);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokenService.revokeRefreshToken(rawRefreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokenService.revokeAllUserTokens(userId);
  }

  async me(userId: string): Promise<UserSummaryDto> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toUserSummary(user);
  }
}
