# CLAUDE.md

Working agreement for AI coding agents (and humans) in this repository.
If a rule here conflicts with what you were about to do, this file wins. If a rule
here is wrong, change the rule in the same commit as the code that breaks it.

## What this is

`ticket-flow` is a single vertical slice of ticket fulfillment: an organizer issues a ticket,
a dispatcher delivers it by email, and a scanner at the gate invalidates it — exactly once.
It is deliberately one journey, end to end, rather than many half-finished ones.

- `api/` — NestJS, TypeScript, Mongoose, REST; also the dispatcher worker entrypoint
- `web/` — React, TypeScript, Vite, React Router, TanStack Query
- `e2e/` — Playwright, against the real Docker Compose stack
- `docs/` — the AI workflow log

## Commands

Run from the repo root unless stated otherwise.

| Task | Command |
| --- | --- |
| Install everything | `npm install` |
| Generate `.env` with random secrets | `npm run bootstrap` |
| Full stack, seeded, one command | `docker compose up --build --wait` |
| API dev server (watch) | `npm run dev -w @ticket-flow/api` |
| Dispatcher worker (watch) | `npm run dev:worker -w @ticket-flow/api` |
| Web dev server | `npm run dev -w @ticket-flow/web` |
| Unit + integration tests | `npm test` |
| End-to-end (stack must be up) | `npm run e2e` |
| Typecheck and hook tests | `npm run check` |

`npm run check` is the gate. Nothing gets committed that does not pass it.

## Architecture rules

### API layering

Dependencies point in one direction. Do not skip a layer, do not call backwards.

```
http/                controllers, guards, request parsing — HTTP shape only
  └─ application/        use cases: load, decide, persist, record; owns transactions
       ├─ domain/            pure rules: the state machine, ticket codes — no Nest, no Mongoose
       └─ infrastructure/    persistence (the only place Mongoose is touched), mail delivery
```

- **`http/` must not import Mongoose, `@nestjs/mongoose`, or anything under
  `infrastructure/`.** A controller calls an application service and nothing else.
- **`application/` must not import Mongoose, `@nestjs/mongoose`, or a `*.schema.ts`.** It
  reaches data through repositories, and transactions through the opaque `Tx` handle.
- **`domain/` must not import `@nestjs/*`, Mongoose or Express.** No decorators, no
  `HttpException`, no status codes. It throws `DomainError` with a machine-readable `code`;
  one exception filter decides what each code means on the wire.
- Anything in `domain/` that can be a pure function should be one. No clock, no randomness:
  the current time is passed in, so the entry-window rule can be tested at its exact edges.

### The state machine is the single source of truth

Every ticket status change goes through `api/src/domain/ticket-state.ts`. It is a pure
function: `(ticket, action, actor, now) => nextStatus | DomainError`.

- Never assign `ticket.status = ...` anywhere else in the codebase.
- Never add a status transition to a controller, a service, the dispatcher, or a Mongoose hook.
- Who may perform an action (role and scope) and which status changes exist are two separate
  tables in that file. Keep them separate.
- Adding a transition means: update the table, add unit tests for the allowed case and for
  every newly-forbidden case, then wire it up. `/new-transition` walks through the order.

The reason this rule exists: fulfillment rules rot when they get sprinkled across a
controller, a worker and a scanner endpoint. Keeping them in one table means the rules can be
read in one screen and tested without a database.

### A ticket is invalidated exactly once

Redeeming at the gate is a conditional write: the update filters on the status the decision
was made against. Two scanners reading the same ticket in the same second must produce one
admission and one refusal — never two admissions and never a corrupted audit trail. There is
an integration test that fires both scans concurrently; do not weaken it.

### Audit trail and outbox are not optional

- Issuing a ticket writes the ticket, its `ISSUE` audit event and its `TICKET_ISSUED` outbox
  message in **one MongoDB transaction**. A ticket that exists but will never be delivered is
  a bug, not a cosmetic issue.
- Every accepted state transition appends an immutable `AuditEvent` in the **same
  transaction** as the status change.
- `AuditEvent` documents are append-only. No update paths, no delete paths, ever. If you add
  a field, it is additive only — old rows cannot be migrated, that is the point.
- Email is sent by the dispatcher, never inside a request. Delivery is at-least-once: a
  duplicate email is acceptable, a lost ticket is not. The gate is the source of truth.

Transactions need a replica set even for local development. `docker-compose.yml` runs a
single-node replica set and the integration tests start an in-memory one for this reason.

### Errors

- One error type from the domain: `DomainError` with a `code` and optional `details`.
- One exception filter maps domain codes to HTTP. Controllers do not build error responses.
- Every error response has the same shape: `{ "error": { "code", "message", "details"? } }`.
- Never send a raw exception, stack trace, or Mongoose validation object to a client.
- `console.log` is not error handling. Use the logger.

### Validation

- Every request body, query and route parameter is parsed with a zod schema at the
  controller boundary. Types come from `z.infer`; do not hand-write a duplicate interface.
- Trust nothing from the client, including ids, role claims and gate names. Role, assigned
  event and gate come from the verified JWT, never from the request body.

## TypeScript rules

- `strict: true` in both workspaces. Do not relax it, do not add per-file escapes.
- No `any`. If you genuinely cannot type something, use `unknown` and narrow it.
- No non-null assertions (`!`). Narrow properly or return early.
- No `as` casts to silence the compiler. A cast that is load-bearing needs a comment
  explaining why it is safe.
- Status, action and role vocabularies are `as const` objects with a derived union type, not
  `enum`s: the values are plain strings that cross the wire and land in MongoDB unchanged.

If the compiler is fighting you, the model is usually wrong. Fix the model.

## NestJS rules

- Controllers are thin: parse, call one application method, return plain data.
- Authentication is a global guard; public routes opt out with `@Public()`. Role checks use
  `@Roles(...)`. A route without either is authenticated by default — that is the safe default.
- Configuration is validated once at bootstrap with zod. A missing or weak `JWT_SECRET` stops
  the process before it binds a port.
- The HTTP API (`main.ts`) and the dispatcher (`worker.ts`) are separate entrypoints over the
  same modules. The dispatcher has no HTTP server and the API never sends email.

## React rules

- Function components and hooks only.
- Components never call `fetch`. All HTTP goes through `web/src/api/`, which returns typed
  data and throws `ApiError` with the server's error code.
- Server state lives in TanStack Query; local UI state lives in `useState`. Do not copy server
  data into component state.
- Role-gated routes exist for user experience only. The server is the authority on every
  permission, and the UI must render a server refusal rather than assume it cannot happen.

## Testing rules

- Every rule in the state machine has a unit test, including the transitions and roles it
  forbids. The matrix tests loop over the real vocabulary so a new status or action widens
  them automatically.
- Every API endpoint has an integration test through supertest, against a real (in-memory)
  MongoDB replica set, covering authorised success and unauthorised rejection.
- The double-scan race has its own integration test: two concurrent scans, one admission.
- One Playwright journey covers issue → deliver → scan → second scan refused.
- Tests must not depend on execution order or on leftover state from a previous test.
- Do not write a test that asserts the implementation. Assert the behaviour.

If a bug is found, the fix commit contains a test that fails without the fix.

## Security rules

This repository is public. Treat it that way.

- No secrets in the repo, in tests, in fixtures, or in git history.
- Config comes from environment variables. `.env.example` documents every variable with a
  placeholder value; `.env` is gitignored.
- `JWT_SECRET` has **no default**. The API must refuse to start without it.
- Passwords are hashed with bcrypt. Seed users are obviously-fake demo accounts on
  `example.test`, a reserved domain.
- Ticket codes come from a CSPRNG and carry at least 100 bits of entropy. A guessable code is
  a free ticket.
- A ticket the caller may not see returns 404, not 403.

## Commit rules

- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.
- Imperative mood, lower case, no trailing period. `feat: add entry window check`.
- One logical change per commit. Formatting churn goes in its own commit.
- Commits produced with agent assistance carry a `Co-Authored-By:` trailer. This repository
  is a work sample about AI-assisted development — hiding the assistance would defeat it.
- Never commit if `npm run check` fails.

## Working with an agent in this repo

- Read `docs/AI-WORKFLOW.md` before large changes; it records what has already gone wrong.
- Prefer editing an existing file to creating a new one.
- Do not add dependencies without saying why in the commit body. Every dependency is a
  maintenance liability in a small team.
- Do not generate documentation nobody asked for. `README.md` and `docs/` are curated.
- When a change touches the state machine, the audit trail, the outbox, or auth, stop and
  flag it for human review rather than committing it as routine.
