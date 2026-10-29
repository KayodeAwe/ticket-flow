/**
 * The gate: turn a scanned code into an admission or a refusal, exactly once per ticket.
 */

import { Injectable } from '@nestjs/common';

import { DomainError, DomainErrorCode } from '../domain/errors.js';
import { normalizeTicketCode } from '../domain/ticket-code.js';
import { decideTransition } from '../domain/ticket-state.js';
import { Role, TicketAction, type Actor } from '../domain/types.js';
import { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import { EventRepository, type EventRecord } from '../infrastructure/persistence/event.repository.js';
import { TicketRepository, type TicketRecord } from '../infrastructure/persistence/ticket.repository.js';
import { UnitOfWork } from '../infrastructure/persistence/unit-of-work.js';
import { Clock } from './ports.js';
import { entryWindowOf, snapshotOf } from './snapshots.js';
import { conflict } from './tickets.service.js';

export interface Admission {
  readonly ticket: TicketRecord;
  readonly event: EventRecord;
}

@Injectable()
export class ScansService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly events: EventRepository,
    private readonly audit: AuditRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * Redeem the ticket behind `rawCode`, or throw the reason it must not be admitted.
   *
   * The read, the decision and the conditional write happen in one transaction. When two
   * scanners present the same code at once, both transactions read the ticket as SENT and
   * both decide to admit; the first to commit wins, and the second hits a write conflict. The
   * driver then re-runs this callback from the top, the read now returns REDEEMED, and the
   * state machine refuses with ALREADY_REDEEMED — saying where the first scan happened. The
   * conditional update is the backstop if that retry ever does not happen.
   */
  async redeem(rawCode: string, actor: Actor): Promise<Admission> {
    if (actor.role !== Role.Scanner) {
      throw new DomainError(DomainErrorCode.ForbiddenRole, 'Only a scanner may redeem tickets.');
    }

    const code = normalizeTicketCode(rawCode);
    if (!code) throw unknownCode();

    return this.uow.run(async (tx) => {
      const ticket = await this.tickets.findByCode(code, tx);
      if (!ticket) throw unknownCode();

      const event = await this.events.findById(ticket.eventId, tx);
      if (!event) throw unknownCode();

      const now = this.clock.now();
      const decision = decideTransition({
        ticket: snapshotOf(ticket, event),
        action: TicketAction.Redeem,
        actor,
        entryWindow: entryWindowOf(event),
        now,
      });

      const updated = await this.tickets.applyTransition(
        ticket.id,
        ticket.status,
        decision.nextStatus,
        tx,
        { at: now, gate: actor.gate },
      );
      if (!updated) throw conflict();

      await this.audit.append(
        {
          ticketId: ticket.id,
          actorId: actor.id,
          actorRole: actor.role,
          action: TicketAction.Redeem,
          fromStatus: ticket.status,
          toStatus: updated.status,
          gate: actor.gate,
          at: now,
        },
        tx,
      );

      return { ticket: updated, event };
    });
  }
}

function unknownCode(): DomainError {
  return new DomainError(DomainErrorCode.NotFound, 'This code does not match any ticket.');
}
