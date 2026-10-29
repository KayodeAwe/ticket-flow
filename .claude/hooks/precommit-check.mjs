#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Bash, gated by `if: Bash(git commit *)`).
 *
 * Enforces the last line of the CLAUDE.md commit rules: "Never commit if
 * `npm run check` fails."
 *
 * A rule like that is worth nothing as prose. An agent under instruction to finish a
 * task will commit a red build and mention the failure in passing, which is easy to
 * miss in a long session. Here the commit simply does not happen: exit 2 on PreToolUse
 * blocks the tool call outright and hands the failing output back as the reason.
 */

import { spawnSync } from 'node:child_process';

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

const root = process.env.CLAUDE_PROJECT_DIR ?? payload?.cwd ?? process.cwd();

const result = spawnSync('npm', ['run', 'check', '--silent'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (result.error) {
  // Could not run the gate at all. Say so loudly rather than waving the commit through.
  process.stderr.write(
    `[precommit-check] could not run "npm run check": ${result.error.message}\n`,
  );
  process.exit(2);
}

if (result.status !== 0) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  process.stderr.write(
    '[precommit-check] BLOCKED: "npm run check" failed, so this commit was not made.\n' +
      'Fix lint and type errors first — CLAUDE.md forbids committing a red tree.\n\n' +
      `${output.split('\n').slice(-40).join('\n')}\n`,
  );
  process.exit(2);
}

process.exit(0);
