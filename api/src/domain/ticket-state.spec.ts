import { describe, expect, it } from 'vitest';

import { DomainError, DomainErrorCode } from './errors.js';
import { decideTransition, findRule, TERMINAL_STATUSES } from './ticket-state.js';
import {
  ALL_ACTIONS,
  ALL_ROLES,
  ALL_STATUSES,
  Role,
  TicketAction,
  TicketStatus,
  type Actor,
  type EntryWindow,
  type TicketSnapshot,
  type TransitionInput,
} from './types.js';

const EVENT_ID = 'event-1';
const OTHER_EVENT_ID = 'event-2';
const ORGANIZER_ID = 'user-organizer';

const WINDOW: EntryWindow = {
  doorsOpenAt: new Date('2026-07-01T17:00:00.000Z'),
  endsAt: new Date('2026-07-01T23:00:00.000Z'),
};
const DURING = new Date('2026-07-01T19:30:00.000Z');

function makeTicket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    id: 'ticket-1',
    status: TicketStatus.Sent,
    eventId: EVENT_ID,
    organizerId: ORGANIZER_ID,
    ...overrides,
  };
}

const organizer = (id: string = ORGANIZER_ID): Actor => ({ role: Role.Organizer, id });
const scanner = (eventId: string = EVENT_ID, gate = 'Gate A'): Actor => ({
  role: Role.Scanner,
  id: `scanner-${gate}`,
  eventId,
  gate,
});
const dispatcher: Actor = { role: Role.System, id: 'system:dispatcher' };

/** An actor of the given role who is in scope for the test ticket. */
function inScope(role: Role): Actor {
  if (role === Role.Organizer) return organizer();
  if (role === Role.Scanner) return scanner();
  return dispatcher;
}

/** The role the specification says may perform each action. */
const ROLE_FOR: Record<TicketAction, Role> = {
  [TicketAction.Send]: Role.System,
  [TicketAction.Redeem]: Role.Scanner,
  [TicketAction.Cancel]: Role.Organizer,
};

function decide(overrides: Partial<TransitionInput> = {}) {
  return decideTransition({
    ticket: makeTicket(),
    action: TicketAction.Redeem,
    actor: scanner(),
    entryWindow: WINDOW,
    now: DURING,
    ...overrides,
  });
}

/** Assert the call is refused, for the stated reason, and return the error for more checks. */
function refusedWith(code: DomainErrorCode, fn: () => unknown): DomainError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    if (!(error instanceof DomainError)) throw error;
    expect(error.code).toBe(code);
    return error;
  }
  throw new Error(`Expected ${code}, but the transition was allowed.`);
}

describe('action policy', () => {
  /**
   * Every (status, action, role) combination where the role is not the one the action
   * belongs to — 4 × 3 × 2 = 24 cases — is refused with FORBIDDEN_ROLE, whatever the status.
   * Looped over the real vocabulary so a new status, action or role widens the matrix
   * automatically instead of leaving a silent hole.
   */
  for (const action of ALL_ACTIONS) {
    for (const role of ALL_ROLES) {
      if (role === ROLE_FOR[action]) continue;

      it(`refuses ${action} by ${role} in every status`, () => {
        for (const status of ALL_STATUSES) {
          refusedWith(DomainErrorCode.ForbiddenRole, () =>
            decide({ ticket: makeTicket({ status }), action, actor: inScope(role) }),
          );
        }
      });
    }
  }
});

describe('transition table completeness', () => {
  /**
   * For the right role, in scope, inside the entry window: every (status, action) pair
   * without a transition is refused, and refused with the code a gate or a dispatcher can act
   * on. The expected codes are written out here from the specification, not read back from
   * the implementation.
   */
  function expectedRefusal(status: TicketStatus, action: TicketAction): DomainErrorCode {
    if (status === TicketStatus.Redeemed && action === TicketAction.Redeem) {
      return DomainErrorCode.AlreadyRedeemed;
    }
    if (status === TicketStatus.Cancelled) return DomainErrorCode.TicketCancelled;
    return DomainErrorCode.InvalidTransition;
  }

  for (const status of ALL_STATUSES) {
    for (const action of ALL_ACTIONS) {
      if (findRule(status, action)) continue;

      it(`refuses ${action} from ${status} with ${expectedRefusal(status, action)}`, () => {
        refusedWith(expectedRefusal(status, action), () =>
          decide({ ticket: makeTicket({ status }), action, actor: inScope(ROLE_FOR[action]) }),
        );
      });
    }
  }

  it('has exactly the five intended transitions', () => {
    const allowed = ALL_STATUSES.flatMap((status) =>
      ALL_ACTIONS.filter((action) => findRule(status, action)).map(
        (action) => `${status} ${action} → ${findRule(status, action)?.to}`,
      ),
    );

    expect(allowed.sort()).toEqual(
      [
        'ISSUED SEND → SENT',
        'ISSUED REDEEM → REDEEMED',
        'SENT REDEEM → REDEEMED',
        'ISSUED CANCEL → CANCELLED',
        'SENT CANCEL → CANCELLED',
      ].sort(),
    );
  });

  it('treats REDEEMED and CANCELLED as terminal', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      [TicketStatus.Cancelled, TicketStatus.Redeemed].sort(),
    );
  });
});

describe('send', () => {
  it('moves an issued ticket to SENT', () => {
    expect(
      decide({
        ticket: makeTicket({ status: TicketStatus.Issued }),
        action: TicketAction.Send,
        actor: dispatcher,
      }),
    ).toEqual({ nextStatus: TicketStatus.Sent });
  });

  it('is not limited by the entry window — tickets go out weeks before the doors open', () => {
    expect(
      decide({
        ticket: makeTicket({ status: TicketStatus.Issued }),
        action: TicketAction.Send,
        actor: dispatcher,
        now: new Date(WINDOW.doorsOpenAt.getTime() - 30 * 24 * 60 * 60 * 1000),
      }),
    ).toEqual({ nextStatus: TicketStatus.Sent });
  });
});

describe('redeem', () => {
  for (const status of [TicketStatus.Issued, TicketStatus.Sent] as const) {
    it(`admits a ${status} ticket at its own event`, () => {
      expect(decide({ ticket: makeTicket({ status }) })).toEqual({
        nextStatus: TicketStatus.Redeemed,
      });
    });
  }

  it('refuses a scanner assigned to a different event', () => {
    refusedWith(DomainErrorCode.WrongEvent, () => decide({ actor: scanner(OTHER_EVENT_ID) }));
  });

  it('says when and where an already-used ticket was used', () => {
    const at = new Date('2026-07-01T19:02:00.000Z');
    const error = refusedWith(DomainErrorCode.AlreadyRedeemed, () =>
      decide({
        ticket: makeTicket({ status: TicketStatus.Redeemed, redemption: { at, gate: 'Gate A' } }),
        actor: scanner(EVENT_ID, 'Gate B'),
      }),
    );

    expect(error.details).toEqual({ redeemedAt: at.toISOString(), gate: 'Gate A' });
    expect(error.message).toContain('Gate A');
  });
});

describe('entry window boundary', () => {
  /**
   * The boundary is the rule, so the boundary itself is tested — not merely a value either
   * side of it. Inclusive at doors-open, exclusive at the end. An off-by-one here is a queue
   * of people with valid tickets being turned away at exactly 17:00.
   */
  const ms = (date: Date, offset: number) => new Date(date.getTime() + offset);

  const cases = [
    { now: ms(WINDOW.doorsOpenAt, -1), admitted: false, label: '1 ms before doors open' },
    { now: WINDOW.doorsOpenAt, admitted: true, label: 'exactly at doors open' },
    { now: ms(WINDOW.endsAt, -1), admitted: true, label: '1 ms before the end' },
    { now: WINDOW.endsAt, admitted: false, label: 'exactly at the end' },
  ] as const;

  for (const { now, admitted, label } of cases) {
    it(`${admitted ? 'admits' : 'refuses'} a scan ${label}`, () => {
      if (admitted) {
        expect(decide({ now })).toEqual({ nextStatus: TicketStatus.Redeemed });
      } else {
        const error = refusedWith(DomainErrorCode.OutsideEntryWindow, () => decide({ now }));
        expect(error.details).toEqual({
          doorsOpenAt: WINDOW.doorsOpenAt.toISOString(),
          endsAt: WINDOW.endsAt.toISOString(),
        });
      }
    });
  }
});

describe('cancel', () => {
  for (const status of [TicketStatus.Issued, TicketStatus.Sent] as const) {
    it(`lets the event's organizer cancel a ${status} ticket`, () => {
      expect(
        decide({ ticket: makeTicket({ status }), action: TicketAction.Cancel, actor: organizer() }),
      ).toEqual({ nextStatus: TicketStatus.Cancelled });
    });
  }

  it("refuses an organizer who does not own the ticket's event", () => {
    refusedWith(DomainErrorCode.NotEventOrganizer, () =>
      decide({ action: TicketAction.Cancel, actor: organizer('user-another-organizer') }),
    );
  });

  it('refuses to cancel a ticket that has already been used', () => {
    refusedWith(DomainErrorCode.InvalidTransition, () =>
      decide({
        ticket: makeTicket({ status: TicketStatus.Redeemed }),
        action: TicketAction.Cancel,
        actor: organizer(),
      }),
    );
  });

  it('is not limited by the entry window', () => {
    expect(
      decide({ action: TicketAction.Cancel, actor: organizer(), now: WINDOW.endsAt }),
    ).toEqual({ nextStatus: TicketStatus.Cancelled });
  });
});

describe('error precedence', () => {
  /**
   * Pinned deliberately. Without these, the order of the guards is an accident of how the
   * function was written, and any refactor can quietly change which reason a caller is given.
   * The order is role → scope → status → window; see the comment on decideTransition.
   */
  it('a forbidden role outranks the wrong organizer', () => {
    refusedWith(DomainErrorCode.ForbiddenRole, () =>
      decide({ action: TicketAction.Redeem, actor: organizer('user-another-organizer') }),
    );
  });

  it("the wrong event outranks the ticket's status — a stranger's ticket is not described", () => {
    refusedWith(DomainErrorCode.WrongEvent, () =>
      decide({
        ticket: makeTicket({
          status: TicketStatus.Redeemed,
          redemption: { at: DURING, gate: 'Gate A' },
        }),
        actor: scanner(OTHER_EVENT_ID),
      }),
    );
  });

  it('the wrong organizer outranks a cancelled ticket', () => {
    refusedWith(DomainErrorCode.NotEventOrganizer, () =>
      decide({
        ticket: makeTicket({ status: TicketStatus.Cancelled }),
        action: TicketAction.Cancel,
        actor: organizer('user-another-organizer'),
      }),
    );
  });

  it('an already-used ticket is reported as used even after the event has ended', () => {
    refusedWith(DomainErrorCode.AlreadyRedeemed, () =>
      decide({ ticket: makeTicket({ status: TicketStatus.Redeemed }), now: WINDOW.endsAt }),
    );
  });

  it('a cancelled ticket is reported as cancelled even before the doors open', () => {
    refusedWith(DomainErrorCode.TicketCancelled, () =>
      decide({
        ticket: makeTicket({ status: TicketStatus.Cancelled }),
        now: new Date(WINDOW.doorsOpenAt.getTime() - 1),
      }),
    );
  });
});
