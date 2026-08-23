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

  findAll(take = 50, skip = 0): Promise<Organization[]> {
    return this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  count(): Promise<number> {
    return this.prisma.organization.count();
  }

  countActive(): Promise<number> {
    return this.prisma.organization.count({ where: { isActive: true } });
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

  async updateJoinCode(id: string, joinCode: string): Promise<Organization> {
    try {
      return await this.prisma.organization.update({
        where: { id },
        data: { joinCode },
      });
    } catch (error) {
      const conflict = toUniqueConstraintError(error);
      if (conflict) {
        throw conflict;
      }
      throw error;
    }
  }

  update(id: string, data: { name?: string }): Promise<Organization> {
    return this.prisma.organization.update({ where: { id }, data });
  }

  setActive(id: string, isActive: boolean): Promise<Organization> {
    return this.prisma.organization.update({
      where: { id },
      data: { isActive },
    });
  }
}
