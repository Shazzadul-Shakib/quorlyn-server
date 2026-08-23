import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from '../../common/repositories/user.repository';
import { MembershipRepository } from '../../common/repositories/membership.repository';
import { OrganizationRepository } from '../../common/repositories/organization.repository';
import { toMembershipSummary } from '../../common/utils/user-summary.util';
import { PlatformUserDto } from './dto/platform-user.dto';
import { PlatformUserDetailDto } from './dto/platform-user-detail.dto';
import { PlatformStatsDto } from './dto/platform-stats.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly membershipRepository: MembershipRepository,
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async stats(): Promise<PlatformStatsDto> {
    const [organizationsTotal, organizationsActive, usersTotal, byRole] =
      await Promise.all([
        this.organizationRepository.count(),
        this.organizationRepository.countActive(),
        this.userRepository.count(),
        this.membershipRepository.countActiveByRole(),
      ]);

    return {
      organizationsTotal,
      organizationsActive,
      organizationsSuspended: organizationsTotal - organizationsActive,
      usersTotal,
      membershipsByRole: byRole,
    };
  }

  async listUsers(
    take: number,
    skip: number,
    q?: string,
  ): Promise<{ items: PlatformUserDto[]; total: number }> {
    const [users, total] = await Promise.all([
      this.userRepository.findManyPaginated(take, skip, q),
      this.userRepository.count(q),
    ]);
    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        platformRole: user.platformRole,
        isActive: user.isActive,
        singleDeviceEnforced: user.singleDeviceEnforced,
        createdAt: user.createdAt,
        membershipCount: user._count.memberships,
      })),
      total,
    };
  }

  async getUser(id: string): Promise<PlatformUserDetailDto> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const memberships =
      await this.membershipRepository.findManyByUserWithOrganization(id);

    return {
      id: user.id,
      email: user.email,
      platformRole: user.platformRole,
      isActive: user.isActive,
      singleDeviceEnforced: user.singleDeviceEnforced,
      createdAt: user.createdAt,
      membershipCount: memberships.length,
      memberships: memberships.map(toMembershipSummary),
    };
  }
}
