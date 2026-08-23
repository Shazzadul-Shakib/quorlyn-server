import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderQuestionsDto {
  @ApiProperty({
    type: [String],
    description:
      'Every question id in the quiz, in the order they should appear',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  questionIds: string[];
}
