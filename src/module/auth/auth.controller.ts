import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { TokenPairResponseDto } from '../../common/dto/token-pair-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/token/jwt-payload.interface';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<AuthTokensResponseDto> {
    return this.authService.login(dto.email, dto.password, requestMeta(req));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  @ApiResponse({ status: 200, type: TokenPairResponseDto })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ): Promise<TokenPairResponseDto> {
    return this.authService.refresh(dto.refreshToken, requestMeta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke a single refresh token' })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke every refresh token for the current user' })
  async logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logoutAll(user.sub);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.authService.me(user.sub);
  }
}

function requestMeta(req: Request) {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}
