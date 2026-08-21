import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaTransactionRunner } from './transaction-runner';

@Global()
@Module({
  providers: [PrismaService, PrismaTransactionRunner],
  exports: [PrismaService, PrismaTransactionRunner],
})
export class PrismaModule {}
