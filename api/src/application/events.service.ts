import { Injectable } from '@nestjs/common';

import { Role, TicketStatus, type Actor } from '../domain/types.js';
import { EventRepository, type EventRecord } from '../infrastructure/persistence/event.repository.js';
import { TicketRepository } from '../infrastructure/persistence/ticket.repository.js';

export interface EventSummary extends EventRecord {
  /** Tickets per status. Organizers only; a scanner sees its event, not its sales. */
  readonly ticketCounts?: Readonly<Record<TicketStatus, number>>;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly events: EventRepository,
    private readonly tickets: TicketRepository,
  ) {}

  /** The events an actor works on: an organizer's own events, or a scanner's assigned one. */
  async listForActor(actor: Actor): Promise<EventSummary[]> {
    if (actor.role === Role.Scanner) {
      const event = await this.events.findById(actor.eventId);
      return event ? [event] : [];
    }

    if (actor.role !== Role.Organizer) return [];

    const events = await this.events.listByOrganizer(actor.id);
    const counts = await this.tickets.countByStatus(events.map((event) => event.id));

    return events.map((event) => {
      const count = (status: TicketStatus): number => counts.get(event.id)?.get(status) ?? 0;
      return {
        ...event,
        ticketCounts: {
          [TicketStatus.Issued]: count(TicketStatus.Issued),
          [TicketStatus.Sent]: count(TicketStatus.Sent),
          [TicketStatus.Redeemed]: count(TicketStatus.Redeemed),
          [TicketStatus.Cancelled]: count(TicketStatus.Cancelled),
        },
      };
    });
  }
}
