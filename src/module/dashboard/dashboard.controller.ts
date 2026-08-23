import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import {
  OrganizationDashboardDto,
  QuizDashboardDto,
  StudentDashboardDto,
  TeacherDashboardDto,
} from './dto/dashboard-response.dto';
import { PeriodQueryDto } from './dto/period.query.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  AuthenticatedUser,
  OrgClaim,
} from '../../common/token/jwt-payload.interface';

@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('teacher')
  @RequirePermissions(Permission.VIEW_RESULTS)
  @ApiQuery({ name: 'mine', required: false, type: Boolean })
  @ApiOperation({ summary: 'Overview of quizzes, together' })
  @ApiResponse({ status: 200, type: TeacherDashboardDto })
  teacher(
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('mine') mine?: string,
  ): Promise<TeacherDashboardDto> {
    return this.dashboardService.forTeacher(
      org.id,
      currentUser.sub,
      mine === 'true',
    );
  }

  @Get('quizzes/:quizId')
  @RequirePermissions(Permission.VIEW_RESULTS)
  @ApiOperation({
    summary:
      'One quiz in detail: participation, score spread, per-question difficulty',
  })
  @ApiResponse({ status: 200, type: QuizDashboardDto })
  quiz(
    @Param('quizId') quizId: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<QuizDashboardDto> {
    return this.dashboardService.forQuiz(quizId, org.id);
  }

  @Get('organization')
  @RequirePermissions(Permission.VIEW_RESULTS)
  @ApiOperation({ summary: 'Organization-wide overview' })
  @ApiResponse({ status: 200, type: OrganizationDashboardDto })
  organization(
    @Query() period: PeriodQueryDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<OrganizationDashboardDto> {
    return this.dashboardService.forOrganization(org.id, period);
  }

  @Get('student')
  @ApiOperation({ summary: 'Your own progress, across every organization' })
  @ApiResponse({ status: 200, type: StudentDashboardDto })
  student(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<StudentDashboardDto> {
    return this.dashboardService.forStudent(currentUser.sub);
  }
}
