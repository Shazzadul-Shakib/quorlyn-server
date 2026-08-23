import { ApiProperty } from '@nestjs/swagger';
import { TokenPairResponseDto } from './token-pair-response.dto';
import { UserSummaryDto } from './user-summary.dto';
import { MembershipSummaryDto } from './membership-summary.dto';
import { OrgContextDto } from './org-context.dto';

export class AuthTokensResponseDto extends TokenPairResponseDto {
  @ApiProperty({ type: UserSummaryDto })
  user: UserSummaryDto;

  @ApiProperty({ type: [MembershipSummaryDto] })
  memberships: MembershipSummaryDto[];

  @ApiProperty({
    type: OrgContextDto,
    nullable: true,
    description:
      'Pre-selected when the user has exactly one active membership; otherwise null and the client must select one.',
  })
  org: OrgContextDto | null;
}
