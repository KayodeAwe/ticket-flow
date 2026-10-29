#!/usr/bin/env node
/**
 * PostToolUse hook (matcher: Edit|Write).
 *
 * Enforces the architectural rules in CLAUDE.md that neither the compiler nor Nest's DI
 * container will catch:
 *
 *   1. http/ must not import Mongoose, @nestjs/mongoose, or anything in infrastructure/.
 *   2. application/ must not import Mongoose, @nestjs/mongoose, or a *.schema file.
 *   3. domain/ must not import @nestjs/*, Mongoose or Express.
 *   4. Ticket status is only ever assigned inside the state machine.
 *
 * These are the rules an agent breaks most readily, because breaking them is always
 * locally convenient: injecting a Mongoose model straight into a controller is one
 * decorator instead of a repository, and setting `.status =` inline reads perfectly well
 * in isolation. Nest makes the first one especially tempting — `@InjectModel` works
 * anywhere the module has registered the schema.
 *
 * PostToolUse exit 2 does not undo the write (the file is already on disk) but it does
 * feed stderr back to the agent, which then fixes it in the next turn. That is the right
 * shape here: the check needs to read the finished file, not a diff fragment.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = await readStdin();
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path ?? '';
if (!filePath.endsWith('.ts')) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? payload?.cwd ?? process.cwd();
const rel = relative(root, filePath).split('\\').join('/');

let source;
try {
  source = readFileSync(filePath, 'utf8');
} catch {
  process.exit(0);
}

/** The one file allowed to assign a ticket status. */
const STATE_MACHINE = 'api/src/domain/ticket-state.ts';

/** Every module specifier this file imports, static or type-only. */
const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

const isMongoose = (spec) => spec === 'mongoose' || spec === '@nestjs/mongoose';

const RULES = [
  {
    applies: rel.startsWith('api/src/http/'),
    forbidden: (spec) => isMongoose(spec) || spec.includes('/infrastructure/'),
    why:
      'Controllers must not touch persistence or mail directly — call an application ' +
      'service, which goes through a repository.',
  },
  {
    applies: rel.startsWith('api/src/application/'),
    forbidden: (spec) => isMongoose(spec) || /\.schema(\.js|\.ts)?$/.test(spec),
    why:
      'Application services reach data through repositories and transactions through the ' +
      'opaque Tx handle, never through Mongoose or a schema directly.',
  },
  {
    applies: rel.startsWith('api/src/domain/'),
    forbidden: (spec) => spec.startsWith('@nestjs/') || isMongoose(spec) || spec === 'express',
    why:
      'The domain layer must stay free of Nest, HTTP and persistence so it can be tested ' +
      'as plain functions.',
  },
];

const violations = [];

for (const rule of RULES) {
  if (!rule.applies) continue;
  for (const spec of imports) {
    if (rule.forbidden(spec)) violations.push(`${rel} imports "${spec}". ${rule.why}`);
  }
}

if (rel !== STATE_MACHINE && rel.startsWith('api/')) {
  // Assignment, not comparison, and not `res.status(...)` which is a call.
  const badAssign = /\.status\s*=(?!=)/.exec(source);
  if (badAssign) {
    const line = source.slice(0, badAssign.index).split('\n').length;
    violations.push(
      `${rel}:${line} assigns to ".status" directly. Every status change goes through ` +
        `${STATE_MACHINE}, so that the transition table stays the single source of truth.`,
    );
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `[check-layering] ${violations.length} architecture rule violation(s) — see CLAUDE.md:\n` +
      violations.map((v) => `  - ${v}`).join('\n') +
      '\n',
  );
  process.exit(2);
}

process.exit(0);
