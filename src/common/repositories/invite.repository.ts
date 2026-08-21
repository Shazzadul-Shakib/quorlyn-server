import { Injectable } from '@nestjs/common';
import { Invite, InviteStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateInviteInput {
  email: string;
  role: Role;
  organizationId: string;
  isOrgOwner: boolean;
  tokenHash: string;
  expiresAt: Date;
  invitedById?: string;
}

@Injectable()
export class InviteRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: CreateInviteInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Invite> {
    return tx.invite.create({ data });
  }

  findPendingByEmailAndOrg(
    email: string,
    organizationId: string,
  ): Promise<Invite | null> {
    return this.prisma.invite.findFirst({
      where: { email, organizationId, status: InviteStatus.PENDING },
    });
  }

  findManyByOrg(organizationId: string): Promise<Invite[]> {
    return this.prisma.invite.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByIdAndOrg(id: string, organizationId: string): Promise<Invite | null> {
    return this.prisma.invite.findFirst({ where: { id, organizationId } });
  }

  findByTokenHash(tokenHash: string): Promise<Invite | null> {
    return this.prisma.invite.findUnique({ where: { tokenHash } });
  }

  updateStatus(
    id: string,
    status: InviteStatus,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Invite> {
    return tx.invite.update({ where: { id }, data: { status } });
  }

  markAccepted(
    id: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Invite> {
    return tx.invite.update({
      where: { id },
      data: { status: InviteStatus.ACCEPTED, acceptedAt: new Date() },
    });
  }
}
