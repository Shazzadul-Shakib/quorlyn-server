import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { QuizLinksService } from './quiz-links.service';
import { QuizLinkPreviewResponseDto } from './dto/quiz-link-preview-response.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Quiz links (public)')
@Controller('quiz-links')
export class QuizLinksController {
  constructor(private readonly quizLinksService: QuizLinksService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({
    summary:
      'Preview a shared exam before signing in — no questions are returned',
  })
  @ApiResponse({ status: 200, type: QuizLinkPreviewResponseDto })
  preview(@Param('token') token: string): Promise<QuizLinkPreviewResponseDto> {
    return this.quizLinksService.preview(token);
  }
}
