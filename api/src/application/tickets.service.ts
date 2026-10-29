/**
 * Organizer use cases: issue, cancel, list, inspect.
 *
 * This layer owns transaction boundaries, because only the use case knows which writes have
 * to succeed together. All decisions about *what may happen* live in the state machine;
 * nothing here branches on status to permit or refuse anything. It loads, asks, writes, and
 * records that it wrote.
 */

import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DomainError, DomainErrorCode } from '../domain/errors.js';
import { encodeTicketCode, TICKET_CODE_BYTES } from '../domain/ticket-code.js';
import { decideIssue, decideTransition } from '../domain/ticket-state.js';
import { Role, TicketAction, type Actor } from '../domain/types.js';
import { AuditAction, AuditRepository, type AuditEventRecord } from '../infrastructure/persistence/audit.repository.js';
import { EventRepository, type EventRecord } from '../infrastructure/persistence/event.repository.js';
import { OutboxRepository, OutboxType } from '../infrastructure/persistence/outbox.repository.js';
import { TicketRepository, type TicketRecord } from '../infrastructure/persistence/ticket.repository.js';
import { UnitOfWork, type Tx } from '../infrastructure/persistence/unit-of-work.js';
import { Clock } from './ports.js';
import { entryWindowOf, snapshotOf } from './snapshots.js';

export interface IssueTicketInput {
  readonly actor: Actor;
  readonly eventId: string;
  readonly holderName: string;
  readonly holderEmail: string;
}

export interface CancelTicketInput {
  readonly actor: Actor;
  readonly ticketId: string;
  readonly reason?: string;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly events: EventRepository,
    private readonly audit: AuditRepository,
    private readonly outbox: OutboxRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * Issue a ticket: the ticket, its ISSUE audit event and its delivery message, written in one
   * transaction. Any one of the three without the others is a bug — a ticket nobody can see
   * the origin of, or one that exists and will never be delivered.
   */
  async issue(input: IssueTicketInput): Promise<TicketRecord> {
    const event = await this.ownedEvent(input.eventId, input.actor);
    const decision = decideIssue(input.actor, event);

    // Generated outside the transaction callback: the driver may run the callback more than
    // once, and the code should not change between attempts.
    const code = encodeTicketCode(randomBytes(TICKET_CODE_BYTES));

    return this.uow.run(async (tx) => {
      const now = this.clock.now();

      const ticket = await this.tickets.create(
        {
          code,
          eventId: event.id,
          holderName: input.holderName,
          holderEmail: input.holderEmail,
          status: decision.nextStatus,
        },
        tx,
      );

      await this.audit.append(
        {
          ticketId: ticket.id,
          actorId: input.actor.id,
          actorRole: input.actor.role,
          action: AuditAction.Issue,
          fromStatus: null,
          toStatus: ticket.status,
          at: now,
        },
        tx,
      );

      await this.outbox.enqueue({ type: OutboxType.TicketIssued, ticketId: ticket.id, at: now }, tx);

      return ticket;
    });
  }

  async cancel(input: CancelTicketInput): Promise<TicketRecord> {
    return this.uow.run(async (tx) => {
      const { ticket, event } = await this.ownedTicket(input.ticketId, input.actor, tx);

      const decision = decideTransition({
        ticket: snapshotOf(ticket, event),
        action: TicketAction.Cancel,
        actor: input.actor,
        entryWindow: entryWindowOf(event),
        now: this.clock.now(),
      });

      const updated = await this.tickets.applyTransition(
        ticket.id,
        ticket.status,
        decision.nextStatus,
        tx,
      );
      if (!updated) throw conflict();

      await this.audit.append(
        {
          ticketId: ticket.id,
          actorId: input.actor.id,
          actorRole: input.actor.role,
          action: TicketAction.Cancel,
          fromStatus: ticket.status,
          toStatus: updated.status,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          at: this.clock.now(),
        },
        tx,
      );

      return updated;
    });
  }

  async get(ticketId: string, actor: Actor): Promise<{ ticket: TicketRecord; event: EventRecord }> {
    return this.ownedTicket(ticketId, actor);
  }

  async listForEvent(eventId: string, actor: Actor): Promise<TicketRecord[]> {
    const event = await this.ownedEvent(eventId, actor);
    return this.tickets.listByEvent(event.id);
  }

  async auditTrail(ticketId: string, actor: Actor): Promise<AuditEventRecord[]> {
    // Authorised against the ticket, not the events: the trail must not be a side door to
    // information the ticket itself would refuse.
    const { ticket } = await this.ownedTicket(ticketId, actor);
    return this.audit.listForTicket(ticket.id);
  }

  /**
   * An event the actor organizes, or NOT_FOUND.
   *
   * Deliberately not a forbidden error. Telling an organizer that an event exists but is not
   * theirs discloses that it exists at all — and its id — which is enough to probe a
   * competitor's event list.
   */
  private async ownedEvent(eventId: string, actor: Actor, tx?: Tx): Promise<EventRecord> {
    const event = await this.events.findById(eventId, tx);
    if (!event || actor.role !== Role.Organizer || event.organizerId !== actor.id) {
      throw new DomainError(DomainErrorCode.NotFound, 'Event not found.');
    }
    return event;
  }

  private async ownedTicket(
    ticketId: string,
    actor: Actor,
    tx?: Tx,
  ): Promise<{ ticket: TicketRecord; event: EventRecord }> {
    const ticket = await this.tickets.findById(ticketId, tx);
    if (!ticket) throw new DomainError(DomainErrorCode.NotFound, 'Ticket not found.');

    try {
      return { ticket, event: await this.ownedEvent(ticket.eventId, actor, tx) };
    } catch (error) {
      if (error instanceof DomainError && error.code === DomainErrorCode.NotFound) {
        throw new DomainError(DomainErrorCode.NotFound, 'Ticket not found.');
      }
      throw error;
    }
  }
}

export function conflict(): DomainError {
  return new DomainError(
    DomainErrorCode.Conflict,
    'This ticket was changed by someone else. Reload it and try again.',
  );
}
