#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Edit|Write).
 *
 * Enforces the CLAUDE.md rule: "This repository is public. Treat it that way.
 * No secrets in the repo, in tests, in fixtures, or in git history."
 *
 * Exit 2 blocks the write; stderr is handed back to the agent as the reason.
 *
 * Written in Node rather than bash/PowerShell on purpose: this is a Node repo, so
 * Node is guaranteed present, and the hook then behaves identically for a reviewer
 * on Windows, macOS or Linux. A bash hook would silently not run for half of them.
 */

import { basename } from 'node:path';

/** Values that look secret-shaped but are obviously fill-me-in placeholders. */
const PLACEHOLDER =
  /^(replace[-_]?me|change[-_]?me|your[-_]|example|placeholder|dummy|fake|test|x{3,}|<|\$\{|process\.env\.)/i;

const SECRET_PATTERNS = [
  { label: 'a private key block', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { label: 'an AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'a GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { label: 'a Stripe secret key', re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  {
    label: 'credentials embedded in a connection URI',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|redis|amqps?):\/\/[^\s:@/]+:[^\s:@/]+@/,
  },
];

/** KEY = <long value> style assignments. */
const ASSIGNED_SECRET =
  /\b(secret|token|password|passwd|api[_-]?key|private[_-]?key|credentials?)\s*[:=]\s*["'`]?([^\s"'`,;]{16,})["'`]?/gi;

function block(reason) {
  process.stderr.write(`[guard-secrets] BLOCKED: ${reason}\n`);
  process.exit(2);
}

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
  // Malformed input should not wedge the session. Fail open, but say so.
  process.stderr.write('[guard-secrets] could not parse hook payload; skipping scan\n');
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path ?? '';
const name = basename(filePath);

// 1. Never write a real dotenv file. .env.example is the documented exception.
if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) {
  block(
    `refusing to write "${name}". Real environment files must never be committed. ` +
      `Document the variable in .env.example with a placeholder value instead.`,
  );
}

// 2. Scan the content being written. Write gives `content`; Edit gives `new_string`.
const content = [payload?.tool_input?.content, payload?.tool_input?.new_string]
  .filter((value) => typeof value === 'string')
  .join('\n');

if (!content) process.exit(0);

for (const { label, re } of SECRET_PATTERNS) {
  if (re.test(content)) {
    block(`the content being written to ${name || 'this file'} contains ${label}.`);
  }
}

for (const match of content.matchAll(ASSIGNED_SECRET)) {
  const [, key, value] = match;
  if (PLACEHOLDER.test(value)) continue;
  block(
    `"${key}" is assigned a literal ${value.length}-character value in ${name || 'this file'}. ` +
      `Read it from the environment, or use a placeholder that starts with "replace-me".`,
  );
}

process.exit(0);
