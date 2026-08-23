import { ApiProperty } from '@nestjs/swagger';
import { OrgContextDto } from '../../../common/dto/org-context.dto';

/**
 * Selecting an organization re-signs the access token only — the refresh
 * token is scoped to a user and a device, not an organization (ADR-0007).
 */
export class SelectOrganizationResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Access token lifetime in seconds' })
  accessTokenExpiresIn: number;

  @ApiProperty({ type: OrgContextDto })
  org: OrgContextDto;
}
