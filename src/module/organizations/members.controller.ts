import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@prisma/client';
import { MembersService } from './members.service';
import { MemberResponseDto } from './dto/member-response.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { ListMembersQueryDto } from './dto/list-members.query.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import type { OrgClaim } from '../../common/token/jwt-payload.interface';

@ApiTags('Members')
@ApiBearerAuth('access-token')
@Controller('members')
@RequirePermissions(Permission.MANAGE_MEMBERS)
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @ApiOperation({ summary: "List the selected organization's members" })
  @ApiResponse({ status: 200, type: [MemberResponseDto] })
  list(
    @Query() query: ListMembersQueryDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<{ items: MemberResponseDto[]; total: number }> {
    return this.membersService.list(org.id, query.role, query.take, query.skip);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one member' })
  @ApiResponse({ status: 200, type: MemberResponseDto })
  findById(
    @Param('id') id: string,
    @CurrentOrg() org: OrgClaim,
  ): Promise<MemberResponseDto> {
    return this.membersService.findById(id, org.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change a member’s permissions, ownership, or status',
  })
  @ApiResponse({ status: 200, type: MemberResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMemberDto,
    @CurrentOrg() org: OrgClaim,
  ): Promise<MemberResponseDto> {
    return this.membersService.update(id, org.id, dto);
  }
}
