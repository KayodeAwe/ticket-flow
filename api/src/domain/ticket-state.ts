/**
 * The ticket state machine.
 *
 * This is the only place in the codebase that decides or assigns a ticket status. The HTTP
 * layer, the application services and the dispatcher all ask this module what happens next;
 * nothing else branches on status to gate an action. `CLAUDE.md` states the rule, and
 * `.claude/hooks/check-layering.mjs` enforces it on every write.
 *
 * The whole module is pure: no database, no clock, no randomness, no Nest. That is what lets
 * the tests walk the entire (status × action × role) matrix in milliseconds, and assert every
 * combination the machine must *refuse* — the half of the behaviour a happy-path suite skips.
 *
 *      ISSUED ──send────▶ SENT
 *      ISSUED ──redeem──▶ REDEEMED     while the entry window is open
 *      SENT   ──redeem──▶ REDEEMED     while the entry window is open
 *      ISSUED ──cancel──▶ CANCELLED
 *      SENT   ──cancel──▶ CANCELLED
 *
 * REDEEMED and CANCELLED are terminal.
 */

import { DomainError, DomainErrorCode } from './errors.js';
import {
  Role,
  TicketAction,
  TicketStatus,
  type Actor,
  type TicketSnapshot,
  type TransitionInput,
  type TransitionResult,
} from './types.js';

/** What, beyond the role, ties an actor to a particular ticket. */
const Scope = {
  /** Any ticket. Only the dispatcher has this. */
  Any: 'ANY',
  /** Only tickets for events this organizer owns. */
  EventOrganizer: 'EVENT_ORGANIZER',
  /** Only tickets for the event this scanner is assigned to. */
  AssignedEvent: 'ASSIGNED_EVENT',
} as const;

type Scope = (typeof Scope)[keyof typeof Scope];

interface ActionPolicy {
  readonly role: Role;
  readonly scope: Scope;
}

/**
 * Who may perform each action at all, whatever the ticket's status.
 *
 * Kept apart from the transition table on purpose. An organizer may never redeem a ticket —
 * not from SENT, not from ISSUED, not ever — so the role belongs to the action, not to each
 * row. Writing it per row would let a future row quietly grant it.
 */
const ACTION_POLICY: Readonly<Record<TicketAction, ActionPolicy>> = {
  [TicketAction.Send]: { role: Role.System, scope: Scope.Any },
  [TicketAction.Redeem]: { role: Role.Scanner, scope: Scope.AssignedEvent },
  [TicketAction.Cancel]: { role: Role.Organizer, scope: Scope.EventOrganizer },
};

interface TransitionRule {
  readonly from: TicketStatus;
  readonly action: TicketAction;
  readonly to: TicketStatus;
  /** Only allowed while the event's entry window is open. */
  readonly requiresEntryWindow: boolean;
}

/**
 * The transition table. Adding a row here is the *only* supported way to add a transition —
 * see `.claude/skills/new-transition/SKILL.md` for the required order of operations, which
 * puts the negative tests before the implementation.
 *
 * Redeeming from ISSUED is deliberate: a holder can stand at the gate with a ticket from the
 * box office or the app before the delivery email has gone out. Delivery is a convenience;
 * the gate is the source of truth.
 */
const TRANSITIONS: readonly TransitionRule[] = [
  {
    from: TicketStatus.Issued,
    action: TicketAction.Send,
    to: TicketStatus.Sent,
    requiresEntryWindow: false,
  },
  {
    from: TicketStatus.Issued,
    action: TicketAction.Redeem,
    to: TicketStatus.Redeemed,
    requiresEntryWindow: true,
  },
  {
    from: TicketStatus.Sent,
    action: TicketAction.Redeem,
    to: TicketStatus.Redeemed,
    requiresEntryWindow: true,
  },
  {
    from: TicketStatus.Issued,
    action: TicketAction.Cancel,
    to: TicketStatus.Cancelled,
    requiresEntryWindow: false,
  },
  {
    from: TicketStatus.Sent,
    action: TicketAction.Cancel,
    to: TicketStatus.Cancelled,
    requiresEntryWindow: false,
  },
];

/** Statuses from which nothing further can happen. Derived, never hand-maintained. */
export const TERMINAL_STATUSES: readonly TicketStatus[] = Object.values(TicketStatus).filter(
  (status) => !TRANSITIONS.some((rule) => rule.from === status),
);

export function findRule(from: TicketStatus, action: TicketAction): TransitionRule | undefined {
  return TRANSITIONS.find((rule) => rule.from === from && rule.action === action);
}

/**
 * Decide whether `actor` may issue a ticket for an event, and the status it starts in.
 *
 * Issuing is not a transition — there is no status before it — but it is still a decision,
 * so it lives here beside the others, and the initial status is decided here rather than
 * written as a literal wherever tickets are created.
 */
export function decideIssue(
  actor: Actor,
  event: { readonly organizerId: string },
): TransitionResult {
  if (actor.role !== Role.Organizer) {
    throw new DomainError(DomainErrorCode.ForbiddenRole, `Role ${actor.role} may not issue a ticket.`);
  }
  if (actor.id !== event.organizerId) {
    throw new DomainError(
      DomainErrorCode.NotEventOrganizer,
      "Only the event's organizer may issue tickets for it.",
    );
  }
  return { nextStatus: TicketStatus.Issued };
}

/**
 * Why there is no transition for this pair.
 *
 * Most pairs get INVALID_TRANSITION. Two get their own code because someone at a gate has to
 * act on the difference: "already used at Gate A at 19:02" calls for a supervisor, "cancelled"
 * sends the holder to the box office. Both are 409 on the wire; the code is what a scanner
 * app shows.
 */
function refusal(ticket: TicketSnapshot, action: TicketAction): DomainError {
  if (ticket.status === TicketStatus.Redeemed && action === TicketAction.Redeem) {
    return new DomainError(
      DomainErrorCode.AlreadyRedeemed,
      ticket.redemption
        ? `This ticket was already used at ${ticket.redemption.gate}.`
        : 'This ticket was already used.',
      ticket.redemption
        ? { redeemedAt: ticket.redemption.at.toISOString(), gate: ticket.redemption.gate }
        : undefined,
    );
  }

  if (ticket.status === TicketStatus.Cancelled) {
    return new DomainError(DomainErrorCode.TicketCancelled, 'This ticket has been cancelled.');
  }

  return new DomainError(
    DomainErrorCode.InvalidTransition,
    `Cannot ${action} a ticket that is ${ticket.status}.`,
  );
}

/**
 * Decide the outcome of an action, or throw explaining why it is refused.
 *
 * The order of the checks is deliberate and pinned by the tests:
 *
 *   1. role      — may this kind of actor ever do this?
 *   2. scope     — may this actor do it to *this* ticket?
 *   3. status    — does the transition exist?
 *   4. window    — is the gate open?
 *
 * Authority comes before state so that the refusal never discloses something the caller has
 * no right to know: a scanner at another event's gate hears "wrong event", not "already used
 * at Gate A at 19:02". Status comes before the window so that a ticket which was used is
 * reported as used, even if someone tries it again after the event has ended.
 */
export function decideTransition(input: TransitionInput): TransitionResult {
  const { ticket, action, actor, entryWindow, now } = input;
  const policy = ACTION_POLICY[action];

  if (actor.role !== policy.role) {
    throw new DomainError(
      DomainErrorCode.ForbiddenRole,
      `Role ${actor.role} may not ${action} a ticket.`,
    );
  }

  if (policy.scope === Scope.EventOrganizer && actor.id !== ticket.organizerId) {
    throw new DomainError(
      DomainErrorCode.NotEventOrganizer,
      `Only the event's organizer may ${action} this ticket.`,
    );
  }

  if (
    policy.scope === Scope.AssignedEvent &&
    (actor.role !== Role.Scanner || actor.eventId !== ticket.eventId)
  ) {
    throw new DomainError(DomainErrorCode.WrongEvent, 'This ticket is for a different event.');
  }

  const rule = findRule(ticket.status, action);
  if (!rule) throw refusal(ticket, action);

  if (rule.requiresEntryWindow) {
    const window = {
      doorsOpenAt: entryWindow.doorsOpenAt.toISOString(),
      endsAt: entryWindow.endsAt.toISOString(),
    };

    // Inclusive at doors-open, exclusive at the end. Times are compared as epoch
    // milliseconds rather than Date objects, because `<` on two Dates works by accident of
    // valueOf() and `===` on two Dates never does.
    if (now.getTime() < entryWindow.doorsOpenAt.getTime()) {
      throw new DomainError(
        DomainErrorCode.OutsideEntryWindow,
        'Doors are not open yet for this event.',
        window,
      );
    }
    if (now.getTime() >= entryWindow.endsAt.getTime()) {
      throw new DomainError(DomainErrorCode.OutsideEntryWindow, 'This event has ended.', window);
    }
  }

  return { nextStatus: rule.to };
}
