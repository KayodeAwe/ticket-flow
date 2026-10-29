/**
 * Domain vocabulary for tickets.
 *
 * These are `as const` objects with a derived union type rather than TypeScript `enum`s. The
 * values are plain strings, so they cross the wire, land in MongoDB and appear in the React
 * client without translation, and nothing has to keep a numeric enum and its labels in step.
 */

export const TicketStatus = {
  /** Created and paid for; delivery has not happened yet. */
  Issued: 'ISSUED',
  /** Delivered to the holder by the dispatcher. */
  Sent: 'SENT',
  /** Invalidated at the gate. Terminal. */
  Redeemed: 'REDEEMED',
  /** Voided by the organizer. Terminal. */
  Cancelled: 'CANCELLED',
} as const;

export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketAction = {
  Send: 'SEND',
  Redeem: 'REDEEM',
  Cancel: 'CANCEL',
} as const;

export type TicketAction = (typeof TicketAction)[keyof typeof TicketAction];

export const Role = {
  Organizer: 'ORGANIZER',
  Scanner: 'SCANNER',
  /** The dispatcher. Never a person, never a login. */
  System: 'SYSTEM',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ALL_STATUSES: readonly TicketStatus[] = Object.values(TicketStatus);
export const ALL_ACTIONS: readonly TicketAction[] = Object.values(TicketAction);
export const ALL_ROLES: readonly Role[] = Object.values(Role);

/**
 * Who is acting. A union rather than one shape with optional fields, because a scanner
 * without an assigned event and gate is not a valid scanner — and with optional fields the
 * compiler would let one through.
 */
export type Actor =
  | { readonly role: typeof Role.Organizer; readonly id: string }
  | {
      readonly role: typeof Role.Scanner;
      readonly id: string;
      /** The event this scanner is admitting people to. */
      readonly eventId: string;
      /** Which entrance. Recorded with every redemption. */
      readonly gate: string;
    }
  | { readonly role: typeof Role.System; readonly id: string };

/** When and where a ticket was used. Present once a ticket is redeemed. */
export interface Redemption {
  readonly at: Date;
  readonly gate: string;
}

/**
 * The subset of a ticket the state machine needs to decide a transition.
 *
 * Deliberately not the Mongoose document: the state machine takes a plain snapshot so it can
 * be tested without a database, and so it cannot accidentally persist anything.
 */
export interface TicketSnapshot {
  readonly id: string;
  readonly status: TicketStatus;
  readonly eventId: string;
  /** The organizer who owns the ticket's event. */
  readonly organizerId: string;
  readonly redemption?: Redemption;
}

/** Tickets are valid at the gate from doors-open (inclusive) until the event ends (exclusive). */
export interface EntryWindow {
  readonly doorsOpenAt: Date;
  readonly endsAt: Date;
}

export interface TransitionInput {
  readonly ticket: TicketSnapshot;
  readonly action: TicketAction;
  readonly actor: Actor;
  readonly entryWindow: EntryWindow;
  /** Passed in, never read from the clock, so the window can be tested at its exact edges. */
  readonly now: Date;
}

export interface TransitionResult {
  readonly nextStatus: TicketStatus;
}
