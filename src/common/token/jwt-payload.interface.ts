import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: Role;
  organizationId: string | null;
  isOrgOwner: boolean;
}

export type AuthenticatedUser = JwtPayload;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}
