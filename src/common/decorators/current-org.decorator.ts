import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { OrgClaim, OrgScopedUser } from '../token/jwt-payload.interface';

/**
 * The selected organization claim. Only valid on routes behind
 * OrgContextGuard, which guarantees it is present.
 */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgClaim => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: OrgScopedUser }>();
    return request.user.org;
  },
);
