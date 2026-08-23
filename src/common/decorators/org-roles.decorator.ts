import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '@prisma/client';

export const ORG_ROLES_KEY = 'orgRoles';

/**
 * Gates on the caller's role *in the selected organization* (ADR-0007).
 * Implies an organization must be selected.
 */
export const OrgRoles = (...roles: OrgRole[]) =>
  SetMetadata(ORG_ROLES_KEY, roles);
