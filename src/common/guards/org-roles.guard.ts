import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import type { Request } from 'express';
import { ORG_ROLES_KEY } from '../decorators/org-roles.decorator';
import { AuthenticatedUser } from '../token/jwt-payload.interface';

@Injectable()
export class OrgRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<OrgRole[]>(
      ORG_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const org = request.user?.org;
    if (!org || !required.includes(org.role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }
    return true;
  }
}
