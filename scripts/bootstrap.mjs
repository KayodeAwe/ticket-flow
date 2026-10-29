#!/usr/bin/env node
/**
 * Create a local .env with freshly generated secrets.
 *
 * This exists because of a rule in CLAUDE.md: `JWT_SECRET` has no default anywhere in the
 * codebase, and the API refuses to start without it. That rule is worth keeping — a development
 * fallback secret is how a development secret reaches production — but it does mean
 * `docker compose up` cannot work straight from a clone.
 *
 * The alternative would be a demo secret committed to the compose file, which is the exact
 * habit the rule exists to prevent. So instead: one command, real random values, nothing
 * secret in git.
 */

import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

if (existsSync(envPath)) {
  console.log('.env already exists — leaving it alone.');
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error('.env.example is missing; cannot bootstrap.');
  process.exit(1);
}

copyFileSync(examplePath, envPath);

const signingKey = randomBytes(48).toString('base64url');
const seedPassword = randomBytes(9).toString('base64url');

// MONGODB_URI and SMTP_HOST stay pointed at localhost, for running the API and dispatcher on
// the host against the Compose services. Inside Compose every service gets its own values.
const contents = readFileSync(envPath, 'utf8')
  .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${signingKey}`)
  .replace(/^SEED_PASSWORD=.*$/m, `SEED_PASSWORD=${seedPassword}`);

writeFileSync(envPath, contents, 'utf8');

console.log('Created .env with generated secrets.\n');
console.log('  Demo accounts (after `docker compose up`):');
console.log('    olivia.organizer@example.test   ORGANIZER  Harbour Lights Festival, Winter Jazz Night');
console.log('    sam.scanner@example.test        SCANNER    Harbour Lights Festival, Gate A');
console.log('    gus.scanner@example.test        SCANNER    Harbour Lights Festival, Gate B');
console.log('    wen.scanner@example.test        SCANNER    Winter Jazz Night, Main entrance');
console.log(`\n  Password for all four: ${seedPassword}`);
console.log('\n  This password is in .env, which is gitignored.');
