import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

import type { Role } from '../../domain/types.js';
import type { AuthenticatedUser } from './token.service.js';

export const IS_PUBLIC = 'ticket-flow:public';
export const ROLES = 'ticket-flow:roles';

/** The parts of a request the guard reads and writes. Typed here instead of cast at each use. */
export interface RequestWithUser {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  user?: AuthenticatedUser;
}

/** Opt a route out of authentication. Login and the health probe, and nothing else. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/**
 * Restrict a route to roles. A coarse first filter only — the state machine still decides
 * every action, including the ones this would have let through.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES, roles);

/** The authenticated caller. Only valid behind the global AuthGuard, i.e. on non-public routes. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<RequestWithUser>().user;
  if (!user) {
    // Reaching here means a handler asked for the user on a @Public() route. That is a
    // programming error, not a client error, so it is a 500 rather than a 401.
    throw new Error('CurrentUser used on a route that did not authenticate.');
  }
  return user;
});
