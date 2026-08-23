import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, PlatformRole } from '@prisma/client';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../token/jwt-payload.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Insufficient permissions for this action');
    }

    // Resolution order from ADR-0008: superadmin, then org owner, then the
    // explicit grants on the membership.
    if (user.platformRole === PlatformRole.SUPERADMIN) {
      return true;
    }
    const org = user.org;
    if (!org) {
      throw new ForbiddenException('Select an organization first');
    }
    if (org.isOrgOwner) {
      return true;
    }
    const missing = required.filter(
      (permission) => !org.permissions.includes(permission),
    );
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
