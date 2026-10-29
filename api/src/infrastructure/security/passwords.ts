import bcrypt from 'bcryptjs';

/**
 * bcrypt with a cost of 12.
 *
 * Chosen rather than left at the library default so the cost is a visible, reviewable number.
 * `bcryptjs` over `bcrypt` because the pure-JS build needs no native toolchain, so `npm ci`
 * behaves the same on a laptop and in the Alpine image, with no node-gyp step.
 */
const BCRYPT_COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
