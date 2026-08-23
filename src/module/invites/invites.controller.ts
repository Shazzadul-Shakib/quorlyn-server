import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
import { Permission } from '@prisma/client';
import type { Request } from 'express';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { CreateInviteBatchDto } from './dto/create-invite-batch.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import { InvitePreviewResponseDto } from './dto/invite-preview-response.dto';
import { BatchInviteResponseDto } from './dto/invite-batch-response.dto';
import { ListInvitesQueryDto } from './dto/list-invites.query.dto';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  DEVICE_ID_HEADER,
  DeviceId,
} from '../../common/decorators/device-id.decorator';
import type {
  AuthenticatedUser,
  OrgClaim,
} from '../../common/token/jwt-payload.interface';

@ApiTags('Invites')
@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post()
  @RequirePermissions(Permission.MANAGE_MEMBERS)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Invite one teacher or student into your organization',
  })
  @ApiResponse({ status: 201, type: InviteResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Already a member, or already invited',
  })
  create(
    @Body() dto: CreateInviteDto,
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<InviteResponseDto> {
    return this.invitesService.createInvite(dto, org.id, currentUser.sub);
  }

  @Post('batch')
  @RequirePermissions(Permission.MANAGE_MEMBERS)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Invite up to 100 people at once' })
  @ApiResponse({
    status: 201,
    type: BatchInviteResponseDto,
    description:
      'Always 201. Per-recipient outcomes are in `results` — check them, not just the status code.',
  })
  createBatch(
    @Body() dto: CreateInviteBatchDto,
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<BatchInviteResponseDto> {
    return this.invitesService.createBatch(dto, org.id, currentUser.sub);
  }

  @Get()
  @RequirePermissions(Permission.MANAGE_MEMBERS)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "List your organization's invites" })
  @ApiResponse({ status: 200, type: [InviteResponseDto] })
  list(
    @Query() query: ListInvitesQueryDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<InviteResponseDto[]> {
    return this.invitesService.listForOrg(
      org.id,
      query.status,
      query.take,
      query.skip,
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.MANAGE_MEMBERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke a pending invite' })
  async revoke(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<void> {
    await this.invitesService.revoke(id, org.id);
  }

  @Public()
  @Get('token/:token')
  @ApiOperation({ summary: 'Preview an invite before accepting it' })
  @ApiResponse({ status: 200, type: InvitePreviewResponseDto })
  preview(@Param('token') token: string): Promise<InvitePreviewResponseDto> {
    return this.invitesService.previewByToken(token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('accept')
  @ApiHeader({
    name: DEVICE_ID_HEADER,
    required: false,
    description: 'Required when the resulting account is device-locked',
  })
  @ApiOperation({ summary: 'Accept an invite and start a session' })
  @ApiResponse({ status: 201, type: AuthTokensResponseDto })
  accept(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @DeviceId() deviceId: string | null,
  ): Promise<AuthTokensResponseDto> {
    return this.invitesService.acceptInvite(dto.token, dto.password, {
      deviceId,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }
}
