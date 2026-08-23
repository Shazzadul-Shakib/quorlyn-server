import { Global, Module } from '@nestjs/common';
import { QuizPolicyService } from './quiz-policy.service';
import { GradingService } from './grading.service';
import { AttemptFinalizerService } from './attempt-finalizer.service';
import { QUESTION_GRADER } from './graders/question-grader';
import {
  SingleChoiceGrader,
  TrueFalseGrader,
} from './graders/single-choice.grader';
import { MultiChoiceGrader } from './graders/multi-choice.grader';

/**
 * Exam rules shared by the authoring side and the sitting side. Global so
 * neither module has to depend on the other (which would be circular).
 */
@Global()
@Module({
  providers: [
    QuizPolicyService,
    GradingService,
    AttemptFinalizerService,
    SingleChoiceGrader,
    TrueFalseGrader,
    MultiChoiceGrader,
    {
      provide: QUESTION_GRADER,
      useFactory: (
        single: SingleChoiceGrader,
        trueFalse: TrueFalseGrader,
        multi: MultiChoiceGrader,
      ) => [single, trueFalse, multi],
      inject: [SingleChoiceGrader, TrueFalseGrader, MultiChoiceGrader],
    },
  ],
  exports: [QuizPolicyService, GradingService, AttemptFinalizerService],
})
export class ExamModule {}
