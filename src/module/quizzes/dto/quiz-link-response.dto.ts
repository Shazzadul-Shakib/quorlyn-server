import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QuizLinkResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() quizId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) label: string | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) expiresAt: Date | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxUses: number | null;
  @ApiProperty() usedCount: number;
  @ApiPropertyOptional({ type: Date, nullable: true }) revokedAt: Date | null;
  @ApiProperty() createdAt: Date;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'The raw token, returned once at creation and never again — only its sha256 is stored.',
  })
  token: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Ready-to-share URL, present only on creation',
  })
  url: string | null;
}
