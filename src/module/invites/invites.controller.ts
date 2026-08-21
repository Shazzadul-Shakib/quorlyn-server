import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import { InvitePreviewResponseDto } from './dto/invite-preview-response.dto';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/token/jwt-payload.interface';

@ApiTags('Invites')
@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post()
  @Roles(Role.TEACHER)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Invite a teacher or student into your organization',
  })
  @ApiResponse({ status: 201, type: InviteResponseDto })
  create(
    @Body() dto: CreateInviteDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<InviteResponseDto> {
    return this.invitesService.createInvite(
      dto,
      currentUser.organizationId!,
      currentUser.sub,
    );
  }

  @Get()
  @Roles(Role.TEACHER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "List your organization's invites" })
  @ApiResponse({ status: 200, type: [InviteResponseDto] })
  list(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<InviteResponseDto[]> {
    return this.invitesService.listForOrg(currentUser.organizationId!);
  }

  @Delete(':id')
  @Roles(Role.TEACHER)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke a pending invite' })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.invitesService.revoke(id, currentUser.organizationId!);
  }

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Preview an invite before accepting it' })
  @ApiResponse({ status: 200, type: InvitePreviewResponseDto })
  preview(@Param('token') token: string): Promise<InvitePreviewResponseDto> {
    return this.invitesService.previewByToken(token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('accept')
  @ApiOperation({ summary: 'Accept an invite and create your account' })
  @ApiResponse({ status: 201, type: AuthTokensResponseDto })
  accept(@Body() dto: AcceptInviteDto): Promise<AuthTokensResponseDto> {
    return this.invitesService.acceptInvite(dto.token, dto.password);
  }
}
