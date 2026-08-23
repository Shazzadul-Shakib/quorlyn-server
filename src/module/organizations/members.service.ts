import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, OrgRole } from '@prisma/client';
import { MembershipRepository } from '../../common/repositories/membership.repository';
import { RefreshTokenRepository } from '../../common/repositories/refresh-token.repository';
import { MemberResponseDto } from './dto/member-response.dto';
import { toMemberResponse } from './dto/member-response.util';
import { UpdateMemberDto } from './dto/update-member.dto';

@Injectable()
export class MembersService {
  constructor(
    private readonly membershipRepository: MembershipRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  async list(
    organizationId: string,
    role: OrgRole | undefined,
    take: number,
    skip: number,
  ): Promise<{ items: MemberResponseDto[]; total: number }> {
    const [memberships, total] = await Promise.all([
      this.membershipRepository.findManyByOrgWithUser(
        organizationId,
        role,
        take,
        skip,
      ),
      this.membershipRepository.countByOrg(organizationId, role),
    ]);
    return { items: memberships.map(toMemberResponse), total };
  }

  async findById(
    id: string,
    organizationId: string,
  ): Promise<MemberResponseDto> {
    return toMemberResponse(await this.requireMember(id, organizationId));
  }

  async update(
    id: string,
    organizationId: string,
    dto: UpdateMemberDto,
  ): Promise<MemberResponseDto> {
    const membership = await this.requireMember(id, organizationId);

    if (membership.role === OrgRole.STUDENT && dto.permissions?.length) {
      throw new BadRequestException(
        'Students cannot hold organization permissions',
      );
    }

    // An organization without an active owner cannot be administered at all,
    // so the last one may not stand down or be suspended.
    const losesOwner =
      membership.isOrgOwner &&
      (dto.isOrgOwner === false || dto.status === MembershipStatus.SUSPENDED);
    if (losesOwner) {
      const owners =
        await this.membershipRepository.countOwners(organizationId);
      if (owners <= 1) {
        throw new ConflictException(
          'This is the last active owner; promote another owner first',
        );
      }
    }

    const updated = await this.membershipRepository.update(id, {
      ...(dto.permissions ? { permissions: dto.permissions } : {}),
      ...(dto.isOrgOwner !== undefined ? { isOrgOwner: dto.isOrgOwner } : {}),
      ...(dto.status ? { status: dto.status } : {}),
    });

    // Permissions live in the access token, so a suspension only takes effect
    // at the next refresh unless the sessions go too (ADR-0008).
    if (dto.status === MembershipStatus.SUSPENDED) {
      await this.refreshTokenRepository.revokeAllForUser(membership.userId);
    }

    return toMemberResponse({ ...membership, ...updated });
  }

  private async requireMember(id: string, organizationId: string) {
    const membership = await this.membershipRepository.findByIdInOrg(
      id,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }
    return membership;
  }
}
