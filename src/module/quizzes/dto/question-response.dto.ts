import { ApiProperty } from '@nestjs/swagger';
import { ContentFormat, QuestionType } from '@prisma/client';

/** Teacher-facing: carries the answer key. Requires VIEW_RESULTS or authoring rights. */
export class AnswerKeyOptionDto {
  @ApiProperty() id: string;
  @ApiProperty() text: string;
  @ApiProperty() isCorrect: boolean;
  @ApiProperty() position: number;
}

export class AnswerKeyQuestionDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: QuestionType }) type: QuestionType;
  @ApiProperty() prompt: string;
  @ApiProperty({ enum: ContentFormat }) contentFormat: ContentFormat;
  @ApiProperty() points: number;
  @ApiProperty() position: number;
  @ApiProperty({ type: [AnswerKeyOptionDto] }) options: AnswerKeyOptionDto[];
}

/** Student-facing: structurally has no `isCorrect` field (ADR-0011). */
export class ExamOptionDto {
  @ApiProperty() id: string;
  @ApiProperty() text: string;
}

export class ExamQuestionDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: QuestionType }) type: QuestionType;
  @ApiProperty() prompt: string;
  @ApiProperty({ enum: ContentFormat }) contentFormat: ContentFormat;
  @ApiProperty() points: number;
  @ApiProperty({ type: [ExamOptionDto] }) options: ExamOptionDto[];
}
