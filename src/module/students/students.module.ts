import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { TokenModule } from '../../common/token/token.module';

@Module({
  imports: [TokenModule],
  controllers: [StudentsController],
  providers: [StudentsService],
})
export class StudentsModule {}
