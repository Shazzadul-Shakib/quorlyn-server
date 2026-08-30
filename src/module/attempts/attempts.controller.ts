import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Permission } from '@prisma/client';
import type { Request } from 'express';
import { AttemptsService, AttemptContext } from './attempts.service';
import { AttemptResponseDto } from './dto/attempt-response.dto';
import { ExamStateResponseDto } from './dto/exam-state-response.dto';
import { HeartbeatResponseDto } from './dto/heartbeat-response.dto';
import { SaveAnswerDto } from './dto/save-answer.dto';
import { ReportEventsDto } from './dto/report-events.dto';
import { AttemptDetailResponseDto } from './dto/attempt-detail-response.dto';
import { AttemptReviewResponseDto } from './dto/attempt-review-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { RequireOrg } from '../../common/decorators/require-org.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { DeviceId } from '../../common/decorators/device-id.decorator';
import type {
  AuthenticatedUser,
  OrgClaim,
} from '../../common/token/jwt-payload.interface';

@ApiTags('Attempts')
@ApiBearerAuth('access-token')
@Controller()
export class AttemptsController {
  constructor(private readonly attemptsService: AttemptsService) {}

  @Post('quizzes/:quizId/attempts')
  @RequireOrg()
  @ApiOperation({
    summary: 'Start or resume an attempt — idempotent while one is in progress',
  })
  @ApiResponse({ status: 201, type: AttemptResponseDto })
  @ApiResponse({ status: 403, description: 'No attempts left' })
  @ApiResponse({
    status: 410,
    description: 'Quiz closed, or too late to start',
  })
  start(
    @Param('quizId') quizId: string,
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
    @DeviceId() deviceId: string | null,
  ): Promise<AttemptResponseDto> {
    return this.attemptsService.start(
      quizId,
      org,
      currentUser.platformRole,
      attemptContext(currentUser, req, deviceId),
    );
  }

  @Post('attempts/from-link/:token')
  @ApiOperation({
    summary: 'Start from a shared link, enrolling the student if needed',
  })
  @ApiResponse({ status: 201, type: AttemptResponseDto })
  startFromLink(
    @Param('token') token: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Req() req: Request,
    @DeviceId() deviceId: string | null,
  ): Promise<AttemptResponseDto> {
    return this.attemptsService.startFromLink(
      token,
      currentUser.platformRole,
      attemptContext(currentUser, req, deviceId),
    );
  }

  @Get('attempts/mine')
  @ApiOperation({ summary: 'Your attempts, across every organization' })
  @ApiResponse({ status: 200, type: [AttemptResponseDto] })
  mine(
    @Query() query: PaginationQueryDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AttemptResponseDto[]> {
    return this.attemptsService.myAttempts(
      currentUser.sub,
      undefined,
      query.take,
      query.skip,
    );
  }

  @Get('attempts/:id')
  @ApiOperation({
    summary:
      'The exam screen: questions without the answer key, plus saved answers',
  })
  @ApiResponse({ status: 200, type: ExamStateResponseDto })
  examState(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<ExamStateResponseDto> {
    return this.attemptsService.examState(id, currentUser.sub);
  }

  @Get('attempts/:id/review')
  @ApiOperation({
    summary:
      "The student's own attempt with the answer key — available once the quiz has closed",
  })
  @ApiResponse({ status: 200, type: AttemptReviewResponseDto })
  @ApiResponse({ status: 403, description: 'The quiz has not closed yet' })
  review(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AttemptReviewResponseDto> {
    return this.attemptsService.reviewOwnAttempt(id, currentUser.sub);
  }

  @Put('attempts/:id/answers/:questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipThrottle()
  @ApiOperation({ summary: 'Autosave one answer' })
  @ApiResponse({ status: 204, description: 'Saved' })
  @ApiResponse({ status: 410, description: 'Time is up, or already submitted' })
  async saveAnswer(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: SaveAnswerDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    await this.attemptsService.saveAnswer(
      id,
      questionId,
      currentUser.sub,
      dto.selectedOptionIds,
    );
  }

  @Post('attempts/:id/heartbeat')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @ApiOperation({
    summary:
      'Keep the attempt alive and read the authoritative clock (every 15s)',
  })
  @ApiResponse({ status: 200, type: HeartbeatResponseDto })
  heartbeat(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<HeartbeatResponseDto> {
    return this.attemptsService.heartbeat(id, currentUser.sub);
  }

  @Post('attempts/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit and grade the attempt' })
  @ApiResponse({ status: 200, type: AttemptResponseDto })
  submit(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AttemptResponseDto> {
    return this.attemptsService.submit(id, currentUser.sub);
  }

  @Post('attempts/:id/events')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Report focus/proctoring events; may trigger auto-submission',
  })
  @ApiResponse({ status: 200, type: AttemptResponseDto })
  reportEvents(
    @Param('id') id: string,
    @Body() dto: ReportEventsDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AttemptResponseDto> {
    return this.attemptsService.reportEvents(id, currentUser.sub, dto);
  }

  @Get('quizzes/:quizId/attempts')
  @RequirePermissions(Permission.VIEW_RESULTS)
  @ApiOperation({ summary: 'All attempts at a quiz (teacher)' })
  @ApiResponse({ status: 200, type: [AttemptResponseDto] })
  listForQuiz(
    @Param('quizId') quizId: string,
    @Query() query: PaginationQueryDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<AttemptResponseDto[]> {
    return this.attemptsService.listForQuiz(
      quizId,
      org.id,
      query.take,
      query.skip,
    );
  }

  @Get('attempts/:id/detail')
  @RequirePermissions(Permission.VIEW_RESULTS)
  @ApiOperation({
    summary:
      'One attempt with per-answer correctness and the proctoring timeline (teacher)',
  })
  @ApiResponse({ status: 200, type: AttemptDetailResponseDto })
  detail(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<AttemptDetailResponseDto> {
    return this.attemptsService.detailForTeacher(id, org.id);
  }
}

function attemptContext(
  currentUser: AuthenticatedUser,
  req: Request,
  deviceId: string | null,
): AttemptContext {
  return {
    userId: currentUser.sub,
    deviceId: deviceId ?? currentUser.deviceId,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}
