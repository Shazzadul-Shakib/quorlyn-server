import { ApiProperty } from '@nestjs/swagger';
import { UserSummaryDto } from '../../../common/dto/user-summary.dto';
import { MembershipSummaryDto } from '../../../common/dto/membership-summary.dto';
import { OrgContextDto } from '../../../common/dto/org-context.dto';

export class MeResponseDto {
  @ApiProperty({ type: UserSummaryDto })
  user: UserSummaryDto;

  @ApiProperty({ type: [MembershipSummaryDto] })
  memberships: MembershipSummaryDto[];

  @ApiProperty({ type: OrgContextDto, nullable: true })
  org: OrgContextDto | null;
}
