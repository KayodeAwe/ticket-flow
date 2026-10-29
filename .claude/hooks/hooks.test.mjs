/**
 * Tests for the Claude Code hooks in this directory.
 *
 * Hooks are the part of an AI setup that most often looks right and does nothing: a typo
 * in a matcher, a script that exits 0 on every path, a rule that never actually fires.
 * These tests drive each hook with a representative payload on stdin and assert the exit
 * code, so a hook that has stopped enforcing its rule fails CI like any other regression.
 *
 * Run with:  npm run test:hooks
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));

const BLOCKED = 2;
const ALLOWED = 0;

/** Drive a hook exactly as Claude Code does: JSON on stdin, meaning in the exit code. */
function runHook(script, payload, env = {}) {
  const result = spawnSync('node', [join(HOOKS_DIR, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}

const write = (file_path, content) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  tool_input: { file_path, content },
});

/** Build a throwaway project tree so path-relative rules resolve correctly. */
function withTempProject(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'ticket-flow-hooktest-'));
  try {
    for (const [relPath, contents] of Object.entries(files)) {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents, 'utf8');
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('guard-secrets', () => {
  test('blocks writing a real .env file', () => {
    const { status, stderr } = runHook('guard-secrets.mjs', write('/repo/.env', 'PORT=3000'));
    assert.equal(status, BLOCKED);
    assert.match(stderr, /never be committed/);
  });

  test('allows .env.example, which is the documented exception', () => {
    const { status } = runHook(
      'guard-secrets.mjs',
      write('/repo/.env.example', 'JWT_SECRET=replace-me-with-a-generated-secret\n'),
    );
    assert.equal(status, ALLOWED);
  });

  test('blocks a private key block', () => {
    const { status } = runHook(
      'guard-secrets.mjs',
      write('/repo/api/src/key.ts', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n'),
    );
    assert.equal(status, BLOCKED);
  });

  test('blocks credentials embedded in a connection URI', () => {
    const { status, stderr } = runHook(
      'guard-secrets.mjs',
      write('/repo/api/src/db.ts', 'const uri = "mongodb://admin:s3cr3tpass@cluster/db";'),
    );
    assert.equal(status, BLOCKED);
    assert.match(stderr, /connection URI/);
  });

  test('blocks a long literal assigned to a secret-shaped name', () => {
    const { status } = runHook(
      'guard-secrets.mjs',
      write('/repo/api/src/auth.ts', 'const apiKey = "Zx91kQ8vLpR2mN4tYw7Bc0Hj";'),
    );
    assert.equal(status, BLOCKED);
  });

  test('allows a secret generated at runtime in code', () => {
    // The false positive found while writing the API test harness: a signing key generated
    // per test run matched the "long literal" pattern, because the regex saw
    // `randomBytes(48).toString(` as a 25-character value.
    const { status } = runHook(
      'guard-secrets.mjs',
      write(
        '/repo/api/test/support/harness.ts',
        "useValue({ secret: randomBytes(48).toString('base64url'), ttlMinutes: 5 })",
      ),
    );
    assert.equal(status, ALLOWED);
  });

  test('still blocks an unquoted literal in a config file', () => {
    const { status } = runHook(
      'guard-secrets.mjs',
      write('/repo/deploy/values.yaml', 'password: Zx91kQ8vLpR2mN4tYw7Bc0Hj\n'),
    );
    assert.equal(status, BLOCKED);
  });

  test('allows a secret read from the environment', () => {
    const { status } = runHook(
      'guard-secrets.mjs',
      write('/repo/api/src/auth.ts', 'const jwtSecret = process.env.JWT_SECRET;'),
    );
    assert.equal(status, ALLOWED);
  });

  test('allows ordinary source with no secret in it', () => {
    const { status } = runHook(
      'guard-secrets.mjs',
      write('/repo/api/src/main.ts', 'const app = await NestFactory.create(AppModule);\n'),
    );
    assert.equal(status, ALLOWED);
  });
});

describe('check-layering', () => {
  const edited = (root, relPath) => ({
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: join(root, relPath) },
    cwd: root,
  });

  /** Write one file into a temp project and run the hook against it. */
  function check(relPath, contents) {
    return withTempProject({ [relPath]: contents }, (root) =>
      runHook('check-layering.mjs', edited(root, relPath), { CLAUDE_PROJECT_DIR: root }),
    );
  }

  test('blocks a controller injecting a Mongoose model', () => {
    const { status, stderr } = check(
      'api/src/http/tickets.controller.ts',
      "import { InjectModel } from '@nestjs/mongoose';\nexport class C {}\n",
    );
    assert.equal(status, BLOCKED);
    assert.match(stderr, /must not touch persistence/);
  });

  test('blocks a controller importing a repository from infrastructure', () => {
    const { status } = check(
      'api/src/http/scans.controller.ts',
      "import { TicketRepository } from '../infrastructure/persistence/ticket.repository.js';\n",
    );
    assert.equal(status, BLOCKED);
  });

  test('blocks an application service importing a schema', () => {
    const { status, stderr } = check(
      'api/src/application/tickets.service.ts',
      "import { Ticket } from '../infrastructure/persistence/ticket.schema.js';\n",
    );
    assert.equal(status, BLOCKED);
    assert.match(stderr, /opaque Tx handle/);
  });

  test('allows an application service importing a repository', () => {
    // The false positive that would make the rule unusable: application services are
    // *supposed* to depend on repositories, which live under infrastructure/.
    const { status } = check(
      'api/src/application/tickets.service.ts',
      "import { TicketRepository } from '../infrastructure/persistence/ticket.repository.js';\n" +
        "import type { Tx } from '../infrastructure/persistence/unit-of-work.js';\n",
    );
    assert.equal(status, ALLOWED);
  });

  test('blocks the domain layer importing Nest', () => {
    const { status, stderr } = check(
      'api/src/domain/ticket-code.ts',
      "import { Injectable } from '@nestjs/common';\n",
    );
    assert.equal(status, BLOCKED);
    assert.match(stderr, /free of Nest/);
  });

  test('blocks a status assignment outside the state machine', () => {
    const { status, stderr } = check(
      'api/src/application/dispatch.service.ts',
      "export function markSent(t: { status: string }) {\n  t.status = 'SENT';\n}\n",
    );
    assert.equal(status, BLOCKED);
    assert.match(stderr, /single source of truth/);
  });

  test('allows the state machine itself to assign status', () => {
    const { status } = check(
      'api/src/domain/ticket-state.ts',
      "export function next(t: { status: string }) {\n  t.status = 'SENT';\n}\n",
    );
    assert.equal(status, ALLOWED);
  });

  test('does not mistake res.status(...) for an assignment', () => {
    const { status } = check(
      'api/src/http/domain-error.filter.ts',
      'export const send = (res: { status(n: number): unknown }) => res.status(409);\n',
    );
    assert.equal(status, ALLOWED);
  });

  test('ignores files outside the api workspace', () => {
    const { status } = check('web/src/pages/GatePage.ts', "result.status = 'x';\n");
    assert.equal(status, ALLOWED);
  });
});

describe('precommit-check', () => {
  const commit = (root) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "feat: something"' },
    cwd: root,
  });

  test('blocks the commit when npm run check fails', () => {
    withTempProject(
      {
        'package.json': JSON.stringify({
          name: 'temp',
          scripts: { check: 'node -e "process.exit(1)"' },
        }),
      },
      (root) => {
        const { status, stderr } = runHook('precommit-check.mjs', commit(root), {
          CLAUDE_PROJECT_DIR: root,
        });
        assert.equal(status, BLOCKED);
        assert.match(stderr, /this commit was not made/);
      },
    );
  });

  test('allows the commit when npm run check passes', () => {
    withTempProject(
      {
        'package.json': JSON.stringify({
          name: 'temp',
          scripts: { check: 'node -e "process.exit(0)"' },
        }),
      },
      (root) => {
        const { status } = runHook('precommit-check.mjs', commit(root), {
          CLAUDE_PROJECT_DIR: root,
        });
        assert.equal(status, ALLOWED);
      },
    );
  });
});
