import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toUniqueConstraintError } from './errors';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  singleDeviceEnforced: boolean;
}

export type UserWithMembershipCount = User & {
  _count: { memberships: number };
};

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findManyPaginated(
    take: number,
    skip: number,
    q?: string,
  ): Promise<UserWithMembershipCount[]> {
    return this.prisma.user.findMany({
      where: q ? { email: { contains: q, mode: 'insensitive' } } : undefined,
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  count(q?: string): Promise<number> {
    return this.prisma.user.count({
      where: q ? { email: { contains: q, mode: 'insensitive' } } : undefined,
    });
  }

  async create(
    data: CreateUserInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<User> {
    try {
      return await tx.user.create({ data });
    } catch (error) {
      const conflict = toUniqueConstraintError(error);
      if (conflict) {
        throw conflict;
      }
      throw error;
    }
  }

  async setSingleDeviceEnforced(
    id: string,
    enforced: boolean,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.user.update({
      where: { id },
      data: { singleDeviceEnforced: enforced },
    });
  }
}
