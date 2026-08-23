import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService, LoginContext } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { DeviceChangeRequestDto } from './dto/device-change-request.dto';
import { DeviceChangeVerifyDto } from './dto/device-change-verify.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { SelectOrganizationResponseDto } from './dto/select-organization-response.dto';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { TokenPairResponseDto } from '../../common/dto/token-pair-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  DEVICE_ID_HEADER,
  DeviceId,
} from '../../common/decorators/device-id.decorator';
import type { AuthenticatedUser } from '../../common/token/jwt-payload.interface';

const DEVICE_HEADER_DOC = {
  name: DEVICE_ID_HEADER,
  required: false,
  description:
    'Stable client-generated device identifier. Required for accounts with single-device enforcement (ADR-0017).',
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiHeader(DEVICE_HEADER_DOC)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({
    status: 409,
    description:
      'DEVICE_CONFLICT — already signed in elsewhere; verify by email to move the session.',
  })
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @DeviceId() deviceId: string | null,
  ): Promise<AuthTokensResponseDto> {
    return this.authService.login(
      dto.email,
      dto.password,
      loginContext(req, deviceId),
    );
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('device-change/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Email a code that releases the session from the other device',
  })
  @ApiResponse({
    status: 202,
    description: 'Code sent if the credentials are valid',
  })
  async requestDeviceChange(
    @Body() dto: DeviceChangeRequestDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.requestDeviceChange(
      dto.email,
      dto.password,
      req.headers['user-agent'],
    );
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('device-change/verify')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ ...DEVICE_HEADER_DOC, required: true })
  @ApiOperation({
    summary:
      'Confirm the emailed code, sign out every other device, and sign in here',
  })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  verifyDeviceChange(
    @Body() dto: DeviceChangeVerifyDto,
    @Req() req: Request,
    @DeviceId() deviceId: string | null,
  ): Promise<AuthTokensResponseDto> {
    return this.authService.verifyDeviceChange(
      dto.email,
      dto.password,
      dto.code,
      loginContext(req, deviceId),
    );
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new token pair' })
  @ApiResponse({ status: 200, type: TokenPairResponseDto })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ): Promise<TokenPairResponseDto> {
    return this.authService.refresh(dto.refreshToken, dto.organizationId, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  @Post('organizations/:organizationId/select')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary:
      'Select the organization to act in; returns a re-signed access token',
  })
  @ApiResponse({ status: 200, type: SelectOrganizationResponseDto })
  selectOrganization(
    @Param('organizationId') organizationId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<SelectOrganizationResponseDto> {
    return this.authService.selectOrganization(currentUser, organizationId);
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
  @ApiOperation({ summary: 'Revoke every session for the current user' })
  async logoutAll(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.authService.logoutAll(currentUser.sub);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Current user, memberships, and selected organization',
  })
  @ApiResponse({ status: 200, type: MeResponseDto })
  me(@CurrentUser() currentUser: AuthenticatedUser): Promise<MeResponseDto> {
    return this.authService.me(currentUser);
  }
}

function loginContext(req: Request, deviceId: string | null): LoginContext {
  return {
    deviceId,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}
