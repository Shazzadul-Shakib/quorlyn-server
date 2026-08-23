import { ApiProperty } from '@nestjs/swagger';
import { PlatformUserDto } from './platform-user.dto';
import { MembershipSummaryDto } from '../../../common/dto/membership-summary.dto';

export class PlatformUserDetailDto extends PlatformUserDto {
  @ApiProperty({ type: [MembershipSummaryDto] })
  memberships: MembershipSummaryDto[];
}
