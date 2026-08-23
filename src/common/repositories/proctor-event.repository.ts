import { Injectable } from '@nestjs/common';
import { Prisma, ProctorEvent, ProctorEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateProctorEventInput {
  attemptId: string;
  type: ProctorEventType;
  occurredAt: Date;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class ProctorEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(
    data: CreateProctorEventInput[],
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const { count } = await tx.proctorEvent.createMany({ data });
    return count;
  }

  findManyByAttempt(attemptId: string, take = 200): Promise<ProctorEvent[]> {
    return this.prisma.proctorEvent.findMany({
      where: { attemptId },
      orderBy: { occurredAt: 'asc' },
      take,
    });
  }

  async countByAttempt(
    attemptId: string,
    types: ProctorEventType[],
  ): Promise<number> {
    return this.prisma.proctorEvent.count({
      where: { attemptId, type: { in: types } },
    });
  }
}
