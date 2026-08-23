import { Module } from '@nestjs/common';
import { AttemptsController } from './attempts.controller';
import { AttemptsService } from './attempts.service';
import { AttemptSweeperService } from './attempt-sweeper.service';

@Module({
  controllers: [AttemptsController],
  providers: [AttemptsService, AttemptSweeperService],
  exports: [AttemptsService],
})
export class AttemptsModule {}
