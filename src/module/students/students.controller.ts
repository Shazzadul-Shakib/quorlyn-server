import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { StudentsService } from './students.service';
import { JoinOrganizationDto } from './dto/join-organization.dto';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('join')
  @ApiOperation({
    summary: "Self-register as a student using an organization's join code",
  })
  @ApiResponse({ status: 201, type: AuthTokensResponseDto })
  join(@Body() dto: JoinOrganizationDto): Promise<AuthTokensResponseDto> {
    return this.studentsService.join(dto);
  }
}
