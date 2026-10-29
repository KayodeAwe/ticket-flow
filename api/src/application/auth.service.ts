import { Injectable } from '@nestjs/common';

import { UserRepository, type UserRecord } from '../infrastructure/persistence/user.repository.js';
import { hashPassword, verifyPassword } from '../infrastructure/security/passwords.js';

@Injectable()
export class AuthService {
  /**
   * A bcrypt hash of a value nobody knows, computed once.
   *
   * When the email does not exist we still run a comparison against this, so a login attempt
   * costs the same whether or not the account is real. Returning early on an unknown email
   * leaks the user list through response timing.
   */
  private readonly dummyHash = hashPassword('no-such-account-placeholder');

  constructor(private readonly users: UserRepository) {}

  /** The signed-in user, or null for any wrong email or password — never which one. */
  async login(email: string, password: string): Promise<UserRecord | null> {
    const user = await this.users.findByEmailWithHash(email);
    const matches = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !matches) return null;

    const { passwordHash: _hash, ...record } = user;
    return record;
  }
}
