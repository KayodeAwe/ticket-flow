import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';

import { Role, type Actor } from '../../domain/types.js';

/** Signing configuration. Bound from the environment in HttpModule; tests bind their own. */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export interface AuthConfig {
  readonly secret: string;
  readonly ttlMinutes: number;
}

/** Who is calling: the actor the domain sees, plus what the UI shows. */
export interface AuthenticatedUser {
  readonly actor: Actor;
  readonly email: string;
  readonly name: string;
}

interface TokenPayload {
  sub: string;
  role: Role;
  email: string;
  name: string;
  eventId?: string;
  gate?: string;
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

@Injectable()
export class TokenService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  sign(user: AuthenticatedUser): string {
    const { actor } = user;
    const payload: TokenPayload = {
      sub: actor.id,
      role: actor.role,
      email: user.email,
      name: user.name,
      ...(actor.role === Role.Scanner ? { eventId: actor.eventId, gate: actor.gate } : {}),
    };
    return jwt.sign(payload, this.config.secret, {
      expiresIn: `${this.config.ttlMinutes}m`,
      algorithm: 'HS256',
    });
  }

  /**
   * The caller's identity, or null for any token that is missing, expired, forged or malformed.
   *
   * Role, assigned event and gate are read from the signed token and never from a request
   * body: a scanner cannot admit people to another event, or record a redemption at a gate it
   * is not standing at, by editing what it sends.
   */
  verify(token: string): AuthenticatedUser | null {
    let decoded: unknown;
    try {
      decoded = jwt.verify(token, this.config.secret, { algorithms: ['HS256'] });
    } catch {
      return null;
    }
    if (typeof decoded !== 'object' || decoded === null) return null;

    const { sub, role, email, name, eventId, gate } = decoded as Partial<Record<keyof TokenPayload, unknown>>; // Narrowed field by field below.
    if (!isString(sub) || !isString(email) || !isString(name)) return null;

    if (role === Role.Organizer) return { actor: { role, id: sub }, email, name };
    if (role === Role.Scanner && isString(eventId) && isString(gate)) {
      return { actor: { role, id: sub, eventId, gate }, email, name };
    }
    // SYSTEM is never a login, and anything else is not a role. Either way, not a caller.
    return null;
  }
}
