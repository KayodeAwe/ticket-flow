import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Role } from '../../domain/types.js';
import { IS_PUBLIC, ROLES, type RequestWithUser } from './decorators.js';
import { TokenService } from './token.service.js';

/**
 * The one guard, registered globally.
 *
 * Every route is authenticated unless it opts out with `@Public()`. That default is the point:
 * a new controller someone forgets to decorate is closed, not open.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers['authorization'];

    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'A bearer token is required.' });
    }

    const user = this.tokens.verify(header.slice('Bearer '.length).trim());
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'The token is invalid or has expired.',
      });
    }
    request.user = user;

    const roles = this.reflector.getAllAndOverride<readonly Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(user.actor.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: `Role ${user.actor.role} may not use this endpoint.`,
      });
    }

    return true;
  }
}
