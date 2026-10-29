---
name: new-transition
description: Add a status transition to the ticket state machine in the required order, so the transition table, its negative tests, the audit event and the HTTP or dispatcher wiring never drift apart.
disable-model-invocation: true
allowed-tools: Read, Edit, Grep, Glob, Bash(npm test *), Bash(npm run check)
---

Add a new transition to the ticket state machine: **$ARGUMENTS**

This exists because the order matters. Wiring the endpoint first and backfilling the table
afterwards produces a transition that works in the one case it was tested with, and a table
that no longer describes the system. Follow the steps in order.

## 1. Clarify the rule before writing anything

State it back in exactly this form, and stop if any part is unknown:

> From status **X**, actor role **R** performing action **A** moves the ticket to status
> **Y**, provided **C**.

Then name explicitly:

- Which statuses this action must be **rejected** from, and whether any of them needs its
  own refusal code (as `ALREADY_REDEEMED` does) rather than `INVALID_TRANSITION`.
- Which roles must be **refused** it.
- Which scope applies: the event's organizer, the scanner's assigned event, or none.
- Whether the entry window applies.

## 2. Update the tables only

Edit `api/src/domain/ticket-state.ts`. Add the policy entry if the action is new, and the
transition row. Change nothing else in the repository yet — no controller, no service, no
schema.

## 3. Write the negative tests first, and watch them fail

In `api/src/domain/ticket-state.spec.ts`:

- One test for the allowed transition.
- **One test per status this action must be rejected from**, asserting the specific error
  code, not merely that it threw. The matrix suites cover the generic cases automatically;
  add explicit tests for any special refusal code.
- One test per role that must be refused, and one per scope violation.

Run `npm test -w @ticket-flow/api` and confirm the negative tests fail for the *right
reason* before implementing. A negative test that passes before the rule exists is testing
nothing.

## 4. Persist it with its audit event

The transition is applied with a conditional update (filter on the current status) and
appends an `AuditEvent` in the **same transaction**. Pass the `Tx` handle to every
repository call in that transaction — a Mongoose call without `{ session }` silently runs
outside the transaction and leaves the audit trail with a hole.

## 5. Wire the caller last

HTTP: controller → application service → domain. The controller parses input with a zod
schema and calls one service method; the exception filter maps `DomainError` codes to status
codes. The controller must not import from `infrastructure/`, and must not read or write
`.status` itself.

Dispatcher: the decision still comes from the state machine. The dispatcher never branches on
status to decide what is allowed.

## 6. Verify

```
npm run check
npm test
```

Then run the `domain-invariant-auditor` subagent over the diff. Adding a transition is one of
the changes `CLAUDE.md` marks as requiring human review before commit — flag it rather than
committing it as routine.
