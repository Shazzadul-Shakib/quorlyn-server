import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;

  @ApiPropertyOptional({
    description:
      'Organization to keep selected. Membership is re-read, so a revoked membership yields a token with org = null rather than failing the refresh.',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;
}
