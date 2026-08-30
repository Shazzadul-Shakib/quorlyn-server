import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { QuizzesService } from './quizzes.service';
import { QuestionsService } from './questions.service';
import { QuizLinksService } from './quiz-links.service';
import { LeaderboardService } from './leaderboard.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { QuizResponseDto } from './dto/quiz-response.dto';
import { ListQuizzesQueryDto } from './dto/list-quizzes.query.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto';
import { AnswerKeyQuestionDto } from './dto/question-response.dto';
import { CreateQuizLinkDto } from './dto/create-quiz-link.dto';
import { QuizLinkResponseDto } from './dto/quiz-link-response.dto';
import { LeaderboardResponseDto } from './dto/leaderboard-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireOrg } from '../../common/decorators/require-org.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  AuthenticatedUser,
  OrgClaim,
} from '../../common/token/jwt-payload.interface';

@ApiTags('Quizzes')
@ApiBearerAuth('access-token')
@Controller('quizzes')
export class QuizzesController {
  constructor(
    private readonly quizzesService: QuizzesService,
    private readonly questionsService: QuestionsService,
    private readonly quizLinksService: QuizLinksService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  // ----------------------------------------------------------- quiz CRUD

  @Post()
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({ summary: 'Create a quiz (starts as DRAFT)' })
  @ApiResponse({ status: 201, type: QuizResponseDto })
  create(
    @Body() dto: CreateQuizDto,
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<QuizResponseDto> {
    return this.quizzesService.create(dto, org.id, currentUser.sub);
  }

  @Get()
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({ summary: "List the organization's quizzes" })
  @ApiResponse({ status: 200, type: [QuizResponseDto] })
  list(
    @Query() query: ListQuizzesQueryDto,
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ items: QuizResponseDto[]; total: number }> {
    return this.quizzesService.list(org.id, query, currentUser.sub);
  }

  @Get(':id')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({ summary: 'Get one quiz' })
  @ApiResponse({ status: 200, type: QuizResponseDto })
  findById(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<QuizResponseDto> {
    return this.quizzesService.findById(id, org.id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({
    summary:
      'Update a quiz — published quizzes accept only title, description, window and link policy',
  })
  @ApiResponse({ status: 200, type: QuizResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Field is frozen after publication',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateQuizDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<QuizResponseDto> {
    return this.quizzesService.update(id, org.id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft quiz' })
  async remove(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<void> {
    await this.quizzesService.remove(id, org.id);
  }

  // -------------------------------------------------------- lifecycle

  @Post(':id/publish')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a quiz — questions become immutable' })
  @ApiResponse({ status: 200, type: QuizResponseDto })
  publish(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<QuizResponseDto> {
    return this.quizzesService.publish(id, org.id);
  }

  @Post(':id/close')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a quiz; attempts in flight are finalized as QUIZ_CLOSED',
  })
  @ApiResponse({ status: 200, type: QuizResponseDto })
  close(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<QuizResponseDto> {
    return this.quizzesService.close(id, org.id);
  }

  @Post(':id/archive')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hide a finished quiz from default listings' })
  @ApiResponse({ status: 200, type: QuizResponseDto })
  archive(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<QuizResponseDto> {
    return this.quizzesService.archive(id, org.id);
  }

  @Post(':id/duplicate')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({
    summary:
      'Deep-copy a quiz into a new DRAFT — the way to "edit" a published quiz',
  })
  @ApiResponse({ status: 201, type: QuizResponseDto })
  duplicate(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<QuizResponseDto> {
    return this.quizzesService.duplicate(id, org.id, currentUser.sub);
  }

  // -------------------------------------------------------- questions

  @Get(':id/questions')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({
    summary: 'Authoring view of the questions, including the answer key',
  })
  @ApiResponse({ status: 200, type: [AnswerKeyQuestionDto] })
  listQuestions(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<AnswerKeyQuestionDto[]> {
    return this.questionsService.list(id, org.id);
  }

  @Get(':id/answer-key')
  @RequirePermissions(Permission.VIEW_RESULTS)
  @ApiOperation({
    summary:
      'The correct answers — teachers only, never served to students (ADR-0011)',
  })
  @ApiResponse({ status: 200, type: [AnswerKeyQuestionDto] })
  answerKey(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<AnswerKeyQuestionDto[]> {
    return this.questionsService.list(id, org.id);
  }

  @Post(':id/questions')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({ summary: 'Add a question (draft quizzes only)' })
  @ApiResponse({ status: 201, type: AnswerKeyQuestionDto })
  createQuestion(
    @Param('id') id: string,
    @Body() dto: CreateQuestionDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<AnswerKeyQuestionDto> {
    return this.questionsService.create(id, org.id, dto);
  }

  @Patch(':id/questions/:questionId')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({ summary: 'Edit a question (draft quizzes only)' })
  @ApiResponse({ status: 200, type: AnswerKeyQuestionDto })
  updateQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateQuestionDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<AnswerKeyQuestionDto> {
    return this.questionsService.update(id, questionId, org.id, dto);
  }

  @Delete(':id/questions/:questionId')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a question (draft quizzes only)' })
  async removeQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<void> {
    await this.questionsService.remove(id, questionId, org.id);
  }

  @Put(':id/questions/order')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({ summary: 'Reorder questions (draft quizzes only)' })
  @ApiResponse({ status: 200, type: [AnswerKeyQuestionDto] })
  reorderQuestions(
    @Param('id') id: string,
    @Body() dto: ReorderQuestionsDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<AnswerKeyQuestionDto[]> {
    return this.questionsService.reorder(id, org.id, dto.questionIds);
  }

  // ------------------------------------------------------------- links

  @Post(':id/links')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({ summary: 'Create a shareable exam link' })
  @ApiResponse({
    status: 201,
    type: QuizLinkResponseDto,
    description: 'The raw token is returned only here',
  })
  createLink(
    @Param('id') id: string,
    @Body() dto: CreateQuizLinkDto,
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<QuizLinkResponseDto> {
    return this.quizLinksService.create(id, org.id, currentUser.sub, dto);
  }

  @Get(':id/links')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @ApiOperation({ summary: 'List this quiz’s links and their use counts' })
  @ApiResponse({ status: 200, type: [QuizLinkResponseDto] })
  listLinks(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<QuizLinkResponseDto[]> {
    return this.quizLinksService.list(id, org.id);
  }

  @Delete(':id/links/:linkId')
  @RequirePermissions(Permission.MANAGE_QUIZZES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a link without affecting the quiz' })
  async deleteLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<void> {
    await this.quizLinksService.remove(id, linkId, org.id);
  }

  // ------------------------------------------------------- leaderboard

  @Get(':id/leaderboard')
  @RequireOrg()
  @ApiOperation({
    summary: 'Ranked results, one row per student by scoring policy (ADR-0018)',
  })
  @ApiResponse({ status: 200, type: LeaderboardResponseDto })
  leaderboard(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentOrg() org: OrgClaim,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<LeaderboardResponseDto> {
    return this.leaderboardService.forQuiz(
      id,
      org,
      currentUser.sub,
      query.take,
      query.skip,
    );
  }
}
