import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toUniqueConstraintError } from './errors';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  singleDeviceEnforced: boolean;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
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
