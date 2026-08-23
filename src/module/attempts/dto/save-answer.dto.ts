import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class SaveAnswerDto {
  @ApiProperty({
    type: [String],
    description: 'Option ids. An empty array records a deliberate skip.',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  selectedOptionIds: string[];
}
