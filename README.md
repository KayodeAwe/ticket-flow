# ticket-flow

One vertical slice of ticket fulfillment, built end to end: an organizer issues a ticket, a
dispatcher emails it, and a scanner at the gate invalidates it — exactly once. Every state
change is recorded in an immutable audit trail.

**Stack** — NestJS 12 + Mongoose in strict TypeScript (ESM) · React 19 + Vite + React Router +
TanStack Query · MongoDB replica set · a transactional outbox drained by a separate dispatcher
worker · Mailpit · Docker Compose · GitHub Actions · Vitest · Playwright.

A sibling of [procure-flow](https://github.com/KayodeAwe/Procure-flow): the same engineering
approach on a different domain and a different stack.

## Run it

```bash
npm install
npm run bootstrap        # writes .env with generated secrets, prints the demo password
docker compose up --build --wait
```

Then open **http://localhost:8080** for the app and **http://localhost:8025** for the mailbox.

Four seeded accounts, all sharing the password printed by `npm run bootstrap`:

| Email | Role | Works on |
| --- | --- | --- |
| `olivia.organizer@example.test` | Organizer | Harbour Lights Festival (doors open now), Winter Jazz Night (in two weeks) |
| `sam.scanner@example.test` | Scanner | Harbour Lights Festival, Gate A |
| `gus.scanner@example.test` | Scanner | Harbour Lights Festival, Gate B |
| `wen.scanner@example.test` | Scanner | Winter Jazz Night, Main entrance |

Sign in as Olivia, issue a ticket for Harbour Lights and watch it go from ISSUED to SENT; the
email with its QR code is in Mailpit. Copy the code from the ticket page, sign in as Sam and
scan it: admitted. Scan it again, or as Gus at Gate B: refused, with where it was used. Scan it
as Wen: wrong event — and nothing more.

## How it fits together

```
 browser ──▶ nginx (web) ──/api──▶ Nest API ──────────┐
                                    │  issue: ticket + audit + outbox
                                    │  in ONE transaction
                                    ▼                  ▼
                              MongoDB replica set ◀── dispatcher (worker, N replicas)
                                                       │ claims outbox messages atomically
                                                       ▼
                                                   SMTP (Mailpit)
```

The API never sends email and the dispatcher has no HTTP port. They share the domain and
persistence modules, and nothing else.

## What is actually interesting here

The CRUD is not the point. These four things are:

**A ticket is invalidated exactly once.** Redeeming reads the ticket, asks the state machine,
and writes with a filter on the status it decided against — all in one transaction. Two
scanners presenting the same code in the same moment get one admission and one refusal, and
the refusal says where the first scan happened. There is an integration test that fires both
scans concurrently, five rounds, and a separate one for the conditional write on its own —
because the transaction retry alone makes the race test pass, and the guard deserves its own
proof. ([`docs/AI-WORKFLOW.md`](docs/AI-WORKFLOW.md) has the story.)

**Delivery through a transactional outbox.** Issuing writes the ticket, its audit event and a
`TICKET_ISSUED` message in one transaction, so a ticket can never exist undelivered. The
dispatcher claims messages with a single atomic update and a lease — run as many replicas as
you like (`docker compose up --scale dispatcher=3`) — asks the state machine before sending,
sends outside any transaction, then re-decides and marks the ticket SENT. Delivery is
at-least-once with backoff and a dead-letter state; a duplicate email is harmless, because the
gate admits a code once however many copies exist.

**A pure state machine, with authority checked before state.**
[`ticket-state.ts`](api/src/domain/ticket-state.ts) is the only place a status is decided or
assigned. *Who may act* (role and scope) and *which transitions exist* are two separate
tables, and they are checked in that order: a scanner at another event's gate hears "wrong
event", never "already used at Gate A". The clock is an input, so the entry window is tested at
its exact edges — inclusive at doors-open, exclusive at the end.

**Layering that is enforced, not described.** `http → application → domain`, with
`infrastructure` beside the domain. Controllers cannot touch Mongoose, the domain cannot touch
Nest, and only the state machine can assign a status — checked by
[`.claude/hooks/check-layering.mjs`](.claude/hooks/check-layering.mjs) on every write.

Smaller decisions, all deliberate: ticket codes are 100 bits of Crockford base32, so they
survive being read aloud and typed from a crumpled printout; a ticket another organizer asks
about returns 404, not 403; role, event and gate come from the signed token, never the request
body; login runs a bcrypt comparison even for unknown emails, so response timing does not leak
the user list; the email's Message-ID is stable per ticket, so mail clients fold together the
duplicates at-least-once delivery can produce.

## How it was built

With an AI coding agent doing most of the typing, under a written working agreement, with
review gates.

- **[`CLAUDE.md`](CLAUDE.md)** — the working agreement, committed *before* any application
  code. The git history shows that ordering.
- **[`.claude/`](.claude/)** — three hooks, two subagents, one skill. Every hook enforces a
  specific line of `CLAUDE.md`, and [the hooks have their own tests](.claude/hooks/hooks.test.mjs)
  — including the false positive in the secret scanner that this repository's own test harness
  exposed.
- **[`docs/AI-WORKFLOW.md`](docs/AI-WORKFLOW.md)** — the running log: decisions, mutation
  checks, and the places the agent or I got it wrong, and what caught it.

## Layout

```
api/                  NestJS 12, ESM, strict TypeScript
  src/domain/           the state machine and ticket codes — pure, no Nest, no Mongoose
  src/application/      use cases; owns transactions; the dispatcher
  src/infrastructure/   repositories (the only place Mongoose is touched), SMTP mailer
  src/http/             controllers, the global auth guard, the error filter
  src/main.ts           HTTP entrypoint
  src/worker.ts         dispatcher entrypoint
  test/                 integration tests against an in-memory MongoDB replica set
web/                  React 19, Vite, React Router, TanStack Query; nginx in the container
e2e/                  Playwright, against the real stack, including the real mailbox
```

## Commands

| Task | Command |
| --- | --- |
| Everything, seeded | `docker compose up --build --wait` |
| Typecheck, hook tests, web build | `npm run check` |
| Unit and integration tests | `npm test` |
| End-to-end (stack must be up) | `npm run e2e` |
| API, watch mode (needs Mongo from Compose) | `npm run dev -w @ticket-flow/api` |
| Dispatcher, watch mode | `npm run dev:worker -w @ticket-flow/api` |
| Web, watch mode | `npm run dev -w @ticket-flow/web` |

## Monitoring

`GET /api/health` is public and reports the delivery backlog: how many outbox messages are
waiting, how many have failed for good, and the age of the oldest one waiting. The dispatcher
has no port of its own, so this is how it is watched — `oldestPendingSeconds` climbing while
`pending` stays above zero means tickets are being issued and nobody is sending them. Every log
line from every process is one JSON object, ready for a collector.

## Deliberately out of scope

One journey finished properly, rather than several started. Not here, and not by accident:
payments and pricing, seat maps and ticket categories, event management (events are seeded),
resending a ticket, camera QR scanning in the browser (a hardware reader that types the code
works today), offline validation at the gate with signed codes, rate limiting on login and
scan, and i18n. Each is a real requirement in a real ticketing product; none of them changes
what this slice is meant to show.
