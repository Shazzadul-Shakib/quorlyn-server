import { Injectable } from '@nestjs/common';
import {
  Membership,
  MembershipStatus,
  OrgRole,
  Organization,
  Permission,
  Prisma,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toUniqueConstraintError } from './errors';

export interface CreateMembershipInput {
  userId: string;
  organizationId: string;
  role: OrgRole;
  isOrgOwner?: boolean;
  permissions?: Permission[];
}

export type MembershipWithOrganization = Membership & {
  organization: Organization;
};

export type MembershipWithUser = Membership & {
  user: Pick<User, 'id' | 'email' | 'isActive' | 'createdAt'>;
};

const MEMBER_USER_SELECT = {
  id: true,
  email: true,
  isActive: true,
  createdAt: true,
} as const;

@Injectable()
export class MembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: CreateMembershipInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Membership> {
    try {
      return await tx.membership.create({ data });
    } catch (error) {
      const conflict = toUniqueConstraintError(error);
      if (conflict) {
        throw conflict;
      }
      throw error;
    }
  }

  findByUserAndOrg(
    userId: string,
    organizationId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Membership | null> {
    return tx.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
  }

  findActiveByUserAndOrg(
    userId: string,
    organizationId: string,
  ): Promise<Membership | null> {
    return this.prisma.membership.findFirst({
      where: { userId, organizationId, status: MembershipStatus.ACTIVE },
    });
  }

  findManyByUserWithOrganization(
    userId: string,
  ): Promise<MembershipWithOrganization[]> {
    return this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  findManyByOrgWithUser(
    organizationId: string,
    role?: OrgRole,
    take = 100,
    skip = 0,
  ): Promise<MembershipWithUser[]> {
    return this.prisma.membership.findMany({
      where: { organizationId, ...(role ? { role } : {}) },
      include: { user: { select: MEMBER_USER_SELECT } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      take,
      skip,
    });
  }

  countByOrg(organizationId: string, role?: OrgRole): Promise<number> {
    return this.prisma.membership.count({
      where: { organizationId, ...(role ? { role } : {}) },
    });
  }

  findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<MembershipWithUser | null> {
    return this.prisma.membership.findFirst({
      where: { id, organizationId },
      include: { user: { select: MEMBER_USER_SELECT } },
    });
  }

  update(
    id: string,
    data: Pick<
      Prisma.MembershipUpdateInput,
      'permissions' | 'status' | 'isOrgOwner' | 'role'
    >,
  ): Promise<Membership> {
    return this.prisma.membership.update({ where: { id }, data });
  }

  countOwners(organizationId: string): Promise<number> {
    return this.prisma.membership.count({
      where: {
        organizationId,
        isOrgOwner: true,
        status: MembershipStatus.ACTIVE,
      },
    });
  }

  async countActiveByRole(): Promise<{ role: OrgRole; count: number }[]> {
    const rows = await this.prisma.membership.groupBy({
      by: ['role'],
      where: { status: MembershipStatus.ACTIVE },
      _count: { _all: true },
    });
    return rows.map((row) => ({ role: row.role, count: row._count._all }));
  }
}
