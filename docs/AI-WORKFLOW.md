# AI workflow log

This repository was built with an AI coding agent (Claude Code) doing most of the typing,
with me directing, reviewing and rejecting. This file is the running record of how that
actually went — decisions, review gates, and the places the agent got it wrong.

It is a sibling of [procure-flow](https://github.com/KayodeAwe/Procure-flow): the same
engineering approach — a pure state machine, a transactional audit trail, conditional writes,
mechanical guards around an agent — moved to a different domain and a different stack
(NestJS and React instead of Express and Angular). Where a lesson carried over from
procure-flow, it says so rather than pretending to have been learned twice.

---

## Session 1 — 2026-10-29 — domain, working agreement, guards

### Why ticket fulfillment

The domain was chosen to match a real team's problem: creating tickets, delivering them, and
invalidating them at entry. It keeps everything procure-flow was built to show, and adds two
things that domain forces on you:

- **Exactly-once redemption.** Two scanners at two entrances reading the same ticket in the
  same second is not an edge case at a venue; it is what happens when someone shares a
  screenshot. One must admit and one must refuse.
- **Delivery that cannot be lost.** Issuing a ticket and sending it are separate steps with
  an external system in between. A transactional outbox makes the hand-off atomic: the ticket,
  its audit event and its delivery message are written together or not at all.

### Decisions I did not delegate

- **Who may act and which transitions exist are separate tables.** In procure-flow the roles
  lived on each transition row. Here an organizer may never redeem, whatever the status, so
  the role is a property of the action, not of the row. Splitting them also fixes the order of
  the checks: authority first, then state.
- **Authority is checked before state.** A scanner assigned to another event must hear
  "wrong event", not "already used" — the second answer tells them something about a ticket
  they have no business looking at. This is the opposite precedence from procure-flow, for
  the same reason procure-flow chose its order: don't disclose what the caller may not know.
- **The clock is an input.** The entry window is a boundary rule like procure-flow's budget
  threshold, and a boundary is only testable at its exact edge if the domain does not read
  the time itself.

### The guards, adapted rather than copied

The three hooks carry over. `guard-secrets.mjs` and `precommit-check.mjs` are unchanged.
`check-layering.mjs` was rewritten for the Nest layout (`http → application → domain`, with
`infrastructure` beside the domain), and its test suite gained one test aimed at a false
positive: application services *must* be allowed to import repositories, which live under
`infrastructure/`. A rule that blocks the correct import gets switched off within a day, and
then it blocks nothing.

---

## Session 2 — 2026-10-29 — state machine, persistence, outbox, dispatcher

### Toolchain decisions forced by the stack

- **NestJS 12 ships as ES modules**, so the API is ESM end to end, with `.js` extensions on
  relative imports.
- **There is a build step**, unlike procure-flow. Node 24 can strip types but not decorators,
  and Nest's dependency injection needs decorator metadata.
- **TypeScript 6, not 7.** TypeScript 7 is current, but the Nest CLI pins `~6.0`, and a
  compiler the framework's own tooling does not support is a problem to have on purpose, not
  by default.
- **Vitest needs SWC here.** Its default transform does not emit decorator metadata, so Nest
  could not resolve a single constructor parameter. `unplugin-swc` reads the decorator
  settings from `tsconfig.json`, so there is one source of truth for them.

### Mutation checks before the first domain commit

Rather than trusting a green suite, the state machine was broken three ways on purpose: the
end of the entry window made inclusive, the wrong-event scope check removed, and the
`ALREADY_REDEEMED` special case removed. Each turned the suite red (1, 2 and 3 failing tests
respectively) and each was reverted before the commit. A negative test that still passes with
its rule deleted is decoration.

### The race test proved something other than what I expected

The double-scan test fires two redemptions of one ticket concurrently, five rounds. It passed
first time, and the loser was refused with `ALREADY_REDEEMED`, not `CONFLICT`.

That was the surprise worth recording. Inside a MongoDB transaction, the losing write hits a
write conflict, the driver retries the whole callback, the re-read sees `REDEEMED`, and the
state machine explains the refusal properly. So the test was proving the *transaction retry*,
and would have kept passing if someone deleted the status from the conditional update's
filter — the guard that protects any caller who forgets the transaction.

Fixed by giving the guard its own test: apply a transition decided against a status the ticket
no longer has, and assert it matches nothing. A test that passes is not the same as a test
that pins the thing you think it pins.

### Atomicity is tested by breaking it

Issuing writes three documents in one transaction. The test for that does not just count
documents after a success; it makes the third write fail and asserts that the first two are
gone too. Counting after a success would pass just as well if the writes were three separate
operations.

### Smaller things the compiler and the tools caught

- **A Mongoose field validator comparing two fields** failed to typecheck: field validators
  also run on update queries, where `this` is a `Query`, not the document. Moved to a
  document-level `pre('validate')` hook, which is what the rule actually is.
- **npm 11 now blocks install scripts by default**, so `mongodb-memory-server` did not
  download its MongoDB binary at install time. It fetches it on the first test run instead;
  the test hook timeout allows for that.

---

## Session 3 — 2026-10-29 — HTTP, the React app, and a guard that was wrong

### The secret scanner would have blocked its own repository's tests

The HTTP tests need a JWT signing key. The harness generates one per run —
`secret: randomBytes(48).toString('base64url')` — so there is no test secret to leak. Reading
`guard-secrets.mjs` against that line showed the hook would have **blocked** it: its "long
literal assigned to a secret-shaped name" regex saw `randomBytes(48).toString(` as a
25-character value.

Worth being exact about how this was found, so it is not overclaimed: not by the hook firing.
As in procure-flow, project hooks load from the directory a session starts in, and this
session started elsewhere — so the hook was not running. It was found by reading the rule
against the code, then confirmed by piping the same payload through the committed hook
(blocked, exit 2) and the fixed one (allowed, exit 0).

The fix distinguishes a quoted value from an unquoted one: in a source file an unquoted
right-hand side is an expression, in a YAML or properties file it is the value. Two new hook
tests pin both sides. A guard that blocks correct code gets disabled within a day, and then it
guards nothing — which is worse than never having had it.

### The first React test failed for the right reason, eventually

The gate screen's component test failed first with "found multiple elements with the text
Admit": the verdict panel and the recent-scans list both say it. That is procure-flow's
`APPROVED` lesson again, and the fix is the same — assert against the verdict panel, never
against page text.

The second failure was the real bug: two `role="status"` elements, one per test. Testing
Library only unmounts between tests automatically when Vitest globals are on, and they are
off here, so each test rendered on top of the previous one's DOM. A test-isolation bug that
`CLAUDE.md` forbids, invisible until a second test existed. Fixed with an explicit `cleanup`
in the test setup.

### Smaller things

- **The login controller first destructured a union.** `const { id, ...profile } = user` on a
  `UserRecord` union loses the discriminant — `Omit` is not distributive — so the scanner's
  `eventId` would not have typechecked. Rewritten to narrow on `user.role` directly.
- **The API refuses a weak `JWT_SECRET` before binding a port.** Checked against the built
  ESM output, not just the source: `JWT_SECRET=short node dist/main.js` exits with the
  variable named.

### Not yet verified, and why

At the end of this session the Compose stack and the Playwright journey are written but have
**not been run**. Docker Desktop was not running, and starting it went wrong: the agent
launched it a second time when the first launch looked like it had not taken, the second
backend crashed on startup with a socket it could not access (almost certainly held by the
first), and the app was then reset to factory defaults from its error dialog.

Recorded here because it is the shape of failure this log exists to catch: a tool that
"looked like it didn't start" being retried instead of checked, by an agent working against a
machine it does not own. The rule taken from it: check whether a process is already starting
before launching it again, and leave the user's desktop applications to the user.

Everything from the domain to the HTTP contract is verified by the unit and integration
suites against a real MongoDB replica set. The containers, the nginx proxy, the dispatcher
talking to real SMTP, and the browser journey are not — until the stack has been brought up.
