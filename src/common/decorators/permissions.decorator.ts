import { SetMetadata } from '@nestjs/common';
import { Permission } from '@prisma/client';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Requires every listed permission on the caller's membership (ADR-0008).
 * Org owners and the platform superadmin satisfy any permission.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
