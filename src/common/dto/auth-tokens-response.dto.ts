import { ApiProperty } from '@nestjs/swagger';
import { TokenPairResponseDto } from './token-pair-response.dto';
import { UserSummaryDto } from './user-summary.dto';

export class AuthTokensResponseDto extends TokenPairResponseDto {
  @ApiProperty({ type: UserSummaryDto })
  user: UserSummaryDto;
}
