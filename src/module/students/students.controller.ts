import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { StudentsService } from './students.service';
import { JoinOrganizationDto } from './dto/join-organization.dto';
import { AuthTokensResponseDto } from '../../common/dto/auth-tokens-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import {
  DEVICE_ID_HEADER,
  DeviceId,
} from '../../common/decorators/device-id.decorator';

@ApiTags('Students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('join')
  @ApiHeader({ name: DEVICE_ID_HEADER, required: true })
  @ApiOperation({
    summary: 'Join an organization as a student using its join code',
  })
  @ApiResponse({ status: 201, type: AuthTokensResponseDto })
  join(
    @Body() dto: JoinOrganizationDto,
    @Req() req: Request,
    @DeviceId() deviceId: string | null,
  ): Promise<AuthTokensResponseDto> {
    return this.studentsService.join(dto, {
      deviceId,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }
}
