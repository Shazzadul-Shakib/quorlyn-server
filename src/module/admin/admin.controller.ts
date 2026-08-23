import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { ListUsersQueryDto } from './dto/list-users.query.dto';
import { PlatformUserDto } from './dto/platform-user.dto';
import { PlatformUserDetailDto } from './dto/platform-user-detail.dto';
import { PlatformStatsDto } from './dto/platform-stats.dto';
import { PlatformRoles } from '../../common/decorators/platform-roles.decorator';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin')
@PlatformRoles(PlatformRole.SUPERADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide counts (superadmin)' })
  @ApiResponse({ status: 200, type: PlatformStatsDto })
  stats(): Promise<PlatformStatsDto> {
    return this.adminService.stats();
  }

  @Get('users')
  @ApiOperation({ summary: 'List every user on the platform (superadmin)' })
  @ApiResponse({ status: 200, type: [PlatformUserDto] })
  listUsers(
    @Query() query: ListUsersQueryDto,
  ): Promise<{ items: PlatformUserDto[]; total: number }> {
    return this.adminService.listUsers(query.take, query.skip, query.q);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'A single user and their memberships (superadmin)' })
  @ApiResponse({ status: 200, type: PlatformUserDetailDto })
  getUser(@Param('id') id: string): Promise<PlatformUserDetailDto> {
    return this.adminService.getUser(id);
  }
}
