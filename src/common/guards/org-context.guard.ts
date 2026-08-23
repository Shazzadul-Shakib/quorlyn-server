import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ORG_ROLES_KEY } from '../decorators/org-roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { REQUIRE_ORG_KEY } from '../decorators/require-org.decorator';
import { AuthenticatedUser } from '../token/jwt-payload.interface';

/**
 * Org-scoped routes need an organization in the token (ADR-0007). A route is
 * org-scoped when it declares @RequireOrg, @OrgRoles or @RequirePermissions —
 * so the requirement can never be forgotten on a route that gates on either.
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isOrgScoped =
      this.reflector.getAllAndOverride<boolean>(REQUIRE_ORG_KEY, targets) ||
      (this.reflector.getAllAndOverride<unknown[]>(ORG_ROLES_KEY, targets)
        ?.length ?? 0) > 0 ||
      (this.reflector.getAllAndOverride<unknown[]>(PERMISSIONS_KEY, targets)
        ?.length ?? 0) > 0;

    if (!isOrgScoped) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user?.org) {
      throw new ForbiddenException(
        'Select an organization first: POST /auth/organizations/{id}/select',
      );
    }
    return true;
  }
}
