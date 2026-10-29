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
