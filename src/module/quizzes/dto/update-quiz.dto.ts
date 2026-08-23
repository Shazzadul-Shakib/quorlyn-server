import { PartialType } from '@nestjs/swagger';
import { CreateQuizDto } from './create-quiz.dto';

/**
 * Published quizzes accept only the fields that do not change what was asked
 * or how it was scored — title, description, window, link policy (ADR-0010).
 * The service enforces that; this type just makes everything optional.
 */
export class UpdateQuizDto extends PartialType(CreateQuizDto) {}
