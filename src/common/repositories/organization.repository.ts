import { Injectable } from '@nestjs/common';
import { Organization, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toUniqueConstraintError } from './errors';

export interface CreateOrganizationInput {
  name: string;
  joinCode: string;
}

@Injectable()
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  findByJoinCode(joinCode: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { joinCode } });
  }

  findAll(): Promise<Organization[]> {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    data: CreateOrganizationInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Organization> {
    try {
      return await tx.organization.create({ data });
    } catch (error) {
      const conflict = toUniqueConstraintError(error);
      if (conflict) {
        throw conflict;
      }
      throw error;
    }
  }
}
