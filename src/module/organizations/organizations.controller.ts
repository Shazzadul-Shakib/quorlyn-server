import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permission, PlatformRole } from '@prisma/client';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PlatformRoles } from '../../common/decorators/platform-roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireOrg } from '../../common/decorators/require-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import type {
  AuthenticatedUser,
  OrgClaim,
} from '../../common/token/jwt-payload.interface';

@ApiTags('Organizations')
@ApiBearerAuth('access-token')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @ApiOperation({
    summary: 'Create an organization and invite its first owner (superadmin)',
  })
  @ApiResponse({ status: 201, type: OrganizationResponseDto })
  create(@Body() dto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
    return this.organizationsService.create(dto);
  }

  @Get()
  @PlatformRoles(PlatformRole.SUPERADMIN)
  @ApiOperation({ summary: 'List all organizations (superadmin)' })
  @ApiResponse({ status: 200, type: [OrganizationResponseDto] })
  list(
    @Query() query: PaginationQueryDto,
  ): Promise<{ items: OrganizationResponseDto[]; total: number }> {
    return this.organizationsService.list(query.take, query.skip);
  }

  @Get('current')
  @RequireOrg()
  @ApiOperation({ summary: 'The organization currently selected in the token' })
  @ApiResponse({ status: 200, type: OrganizationResponseDto })
  current(
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.findById(org.id, currentUser);
  }

  @Patch('current')
  @RequirePermissions(Permission.MANAGE_ORGANIZATION)
  @ApiOperation({ summary: 'Rename the current organization' })
  @ApiResponse({ status: 200, type: OrganizationResponseDto })
  update(
    @Body() dto: UpdateOrganizationDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.update(org.id, dto);
  }

  @Post('current/rotate-join-code')
  @RequirePermissions(Permission.MANAGE_ORGANIZATION)
  @ApiOperation({
    summary: 'Issue a new student join code, invalidating the old one',
  })
  @ApiResponse({ status: 201, type: OrganizationResponseDto })
  rotateJoinCode(
    @CurrentOrg() org: OrgClaim,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.rotateJoinCode(org.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an organization by id' })
  @ApiResponse({ status: 200, type: OrganizationResponseDto })
  findById(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.findById(id, currentUser);
  }
}
