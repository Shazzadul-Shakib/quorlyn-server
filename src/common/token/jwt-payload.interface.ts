import { OrgRole, Permission, PlatformRole } from '@prisma/client';

/**
 * The organization the caller is currently acting in. Null until one is
 * selected, which is the normal state right after login for a user with zero
 * or several memberships (ADR-0007).
 */
export interface OrgClaim {
  id: string;
  role: OrgRole;
  isOrgOwner: boolean;
  permissions: Permission[];
}

export interface JwtPayload {
  sub: string;
  platformRole: PlatformRole;
  deviceId: string | null;
  org: OrgClaim | null;
}

export type AuthenticatedUser = JwtPayload;

/** An authenticated caller that has selected an organization. */
export interface OrgScopedUser extends AuthenticatedUser {
  org: OrgClaim;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}
