import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

// The only way a service reaches the database directly: to demarcate a
// transaction spanning more than one repository. It exposes no query API,
// just a callback boundary — repository methods still build every query.
@Injectable()
export class PrismaTransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.prisma.$transaction(work, options);
  }
}
