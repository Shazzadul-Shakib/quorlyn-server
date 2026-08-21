import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/token/jwt-payload.interface';

@ApiTags('Organizations')
@ApiBearerAuth('access-token')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Create an organization and invite its first teacher (owner)',
  })
  @ApiResponse({ status: 201, type: OrganizationResponseDto })
  create(@Body() dto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
    return this.organizationsService.create(dto);
  }

  @Get()
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'List all organizations' })
  @ApiResponse({ status: 200, type: [OrganizationResponseDto] })
  list(): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.list();
  }

  @Get(':id')
  @Roles(Role.SUPERADMIN, Role.TEACHER, Role.STUDENT)
  @ApiOperation({ summary: "Get an organization's details" })
  @ApiResponse({ status: 200, type: OrganizationResponseDto })
  findById(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.findById(id, currentUser);
  }
}
