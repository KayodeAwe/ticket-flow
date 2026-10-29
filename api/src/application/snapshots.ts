/**
 * Turning persisted records into the plain inputs the state machine takes.
 *
 * In one place so that every caller — the HTTP use cases and the dispatcher — hands the state
 * machine the same picture of a ticket. Two hand-built snapshots are two chances to forget the
 * redemption, and a snapshot without it turns "already used at Gate A" into "already used".
 */

import type { EntryWindow, TicketSnapshot } from '../domain/types.js';
import type { EventRecord } from '../infrastructure/persistence/event.repository.js';
import type { TicketRecord } from '../infrastructure/persistence/ticket.repository.js';

export function snapshotOf(ticket: TicketRecord, event: EventRecord): TicketSnapshot {
  return {
    id: ticket.id,
    status: ticket.status,
    eventId: ticket.eventId,
    organizerId: event.organizerId,
    ...(ticket.redemption ? { redemption: ticket.redemption } : {}),
  };
}

export function entryWindowOf(event: EventRecord): EntryWindow {
  return { doorsOpenAt: event.doorsOpenAt, endsAt: event.endsAt };
}
