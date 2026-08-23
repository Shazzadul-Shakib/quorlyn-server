import { Injectable } from '@nestjs/common';
import { Device, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateDeviceInput {
  userId: string;
  deviceIdHash: string;
  label?: string;
}

@Injectable()
export class DeviceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveByUserAndHash(
    userId: string,
    deviceIdHash: string,
  ): Promise<Device | null> {
    return this.prisma.device.findFirst({
      where: { userId, deviceIdHash, revokedAt: null },
    });
  }

  findById(id: string): Promise<Device | null> {
    return this.prisma.device.findUnique({ where: { id } });
  }

  findActiveByUser(userId: string): Promise<Device[]> {
    return this.prisma.device.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /** Re-binds a previously revoked device row rather than accumulating rows. */
  upsert(
    data: CreateDeviceInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<Device> {
    return tx.device.upsert({
      where: {
        userId_deviceIdHash: {
          userId: data.userId,
          deviceIdHash: data.deviceIdHash,
        },
      },
      create: data,
      update: { revokedAt: null, lastSeenAt: new Date(), label: data.label },
    });
  }

  async touch(id: string, now: Date): Promise<void> {
    await this.prisma.device.updateMany({
      where: { id },
      data: { lastSeenAt: now },
    });
  }

  async revokeAllForUser(
    userId: string,
    now: Date,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.device.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
