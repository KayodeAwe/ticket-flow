/**
 * The dispatcher: delivers issued tickets by draining the outbox.
 *
 * Delivery is at-least-once. A crash after the email is accepted but before the ticket is
 * marked SENT means the message is claimed again when its lease runs out, and the holder gets
 * a second copy of the same ticket. That is the right trade: a duplicate email is harmless,
 * because the gate admits a code exactly once however many copies exist; a lost ticket is a
 * customer at the box office. The message id is stable per ticket, so mail clients can fold
 * the duplicates together.
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable } from '@nestjs/common';

import { isDomainError } from '../domain/errors.js';
import { decideTransition } from '../domain/ticket-state.js';
import { Role, TicketAction, type Actor } from '../domain/types.js';
import { AuditRepository } from '../infrastructure/persistence/audit.repository.js';
import { EventRepository } from '../infrastructure/persistence/event.repository.js';
import {
  OutboxRepository,
  OutboxState,
  type OutboxMessageRecord,
} from '../infrastructure/persistence/outbox.repository.js';
import { TicketRepository } from '../infrastructure/persistence/ticket.repository.js';
import { UnitOfWork } from '../infrastructure/persistence/unit-of-work.js';
import { logger } from '../lib/logger.js';
import { Clock, TicketMailer } from './ports.js';
import { entryWindowOf, snapshotOf } from './snapshots.js';
import { conflict } from './tickets.service.js';

export const DISPATCHER: Actor = { role: Role.System, id: 'system:dispatcher' };

/** How long a claim is exclusive. Longer than any sane SMTP round trip. */
const LEASE_MS = 60_000;
/** After this many attempts a message is marked FAILED and left for a human. */
export const MAX_ATTEMPTS = 6;
/** How long to wait when there is nothing to do. */
const IDLE_POLL_MS = 1_000;

/** 5 s, 25 s, ~2 min, ~10 min, capped at 15 min. Spaced out so an SMTP outage is not hammered. */
export function backoffMs(attempts: number): number {
  return Math.min(5_000 * 5 ** Math.max(0, attempts - 1), 15 * 60_000);
}

export type DispatchOutcome = 'idle' | 'sent' | 'skipped' | 'retry' | 'failed' | 'lost-claim';

@Injectable()
export class DispatchService {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly tickets: TicketRepository,
    private readonly events: EventRepository,
    private readonly audit: AuditRepository,
    private readonly uow: UnitOfWork,
    private readonly mailer: TicketMailer,
    private readonly clock: Clock,
  ) {}

  /** Claim and handle one message. Returns what happened, so the loop and the tests can see. */
  async processNext(): Promise<DispatchOutcome> {
    const message = await this.outbox.claimNext(this.clock.now(), LEASE_MS);
    if (!message) return 'idle';

    try {
      return await this.deliver(message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const now = this.clock.now();

      if (message.attempts >= MAX_ATTEMPTS) {
        logger.error('Ticket delivery failed permanently', {
          ticketId: message.ticketId,
          attempts: message.attempts,
          reason,
        });
        return (await this.outbox.fail(message, reason, now)) ? 'failed' : 'lost-claim';
      }

      const retryAt = new Date(now.getTime() + backoffMs(message.attempts));
      logger.warn('Ticket delivery failed; will retry', {
        ticketId: message.ticketId,
        attempts: message.attempts,
        retryAt: retryAt.toISOString(),
        reason,
      });
      return (await this.outbox.retryLater(message, reason, retryAt)) ? 'retry' : 'lost-claim';
    }
  }

  /** Drain the outbox until `signal` aborts. Used by the worker entrypoint. */
  async run(signal: AbortSignal): Promise<void> {
    logger.info('Dispatcher started');

    while (!signal.aborted) {
      let outcome: DispatchOutcome;
      try {
        outcome = await this.processNext();
      } catch (error) {
        // The claim itself failed — almost always the database being unreachable. Back off
        // and try again rather than exiting; the orchestrator restarting us would not help.
        logger.error('Dispatcher could not claim work', {
          message: error instanceof Error ? error.message : String(error),
        });
        outcome = 'idle';
      }

      if (outcome === 'idle') {
        await sleep(IDLE_POLL_MS, undefined, { signal }).catch(() => undefined);
      }
    }

    logger.info('Dispatcher stopped');
  }

  private async deliver(message: OutboxMessageRecord): Promise<DispatchOutcome> {
    const ticket = await this.tickets.findById(message.ticketId);
    const event = ticket ? await this.events.findById(ticket.eventId) : null;
    const now = this.clock.now();

    if (!ticket || !event) {
      return this.skip(message, 'The ticket or its event no longer exists.');
    }

    // Ask the state machine before sending, not just after. A ticket cancelled or already
    // used before its email went out is not delivered at all. This is the dispatcher asking,
    // not deciding: it never looks at the status itself.
    try {
      decideTransition({
        ticket: snapshotOf(ticket, event),
        action: TicketAction.Send,
        actor: DISPATCHER,
        entryWindow: entryWindowOf(event),
        now,
      });
    } catch (error) {
      if (isDomainError(error)) return this.skip(message, `Not sent: ${error.code}`);
      throw error;
    }

    // The external side effect happens outside any transaction: a transaction callback can be
    // retried by the driver, and retrying it would send the email again.
    await this.mailer.send({
      ticketId: ticket.id,
      to: ticket.holderEmail,
      holderName: ticket.holderName,
      eventName: event.name,
      venue: event.venue,
      doorsOpenAt: event.doorsOpenAt,
      code: ticket.code,
    });

    try {
      await this.uow.run(async (tx) => {
        // Re-read and re-decide inside the transaction: the ticket may have been cancelled or
        // scanned while the email was in flight.
        const current = await this.tickets.findById(ticket.id, tx);
        if (!current) throw conflict();

        const decision = decideTransition({
          ticket: snapshotOf(current, event),
          action: TicketAction.Send,
          actor: DISPATCHER,
          entryWindow: entryWindowOf(event),
          now: this.clock.now(),
        });

        const updated = await this.tickets.applyTransition(
          current.id,
          current.status,
          decision.nextStatus,
          tx,
        );
        if (!updated) throw conflict();

        await this.audit.append(
          {
            ticketId: current.id,
            actorId: DISPATCHER.id,
            actorRole: DISPATCHER.role,
            action: TicketAction.Send,
            fromStatus: current.status,
            toStatus: updated.status,
            at: this.clock.now(),
          },
          tx,
        );
      });
    } catch (error) {
      if (!isDomainError(error)) throw error;
      // Cancelled or scanned while the email was in flight. The email is out and cannot be
      // recalled — which is fine, because the gate will refuse the code. Record it and move on
      // rather than retrying a send the state machine will keep refusing.
      logger.warn('Ticket changed while its email was in flight', {
        ticketId: ticket.id,
        code: error.code,
      });
      return this.skip(message, `Email delivered, but ticket became ${error.code} in flight.`);
    }

    const completed = await this.outbox.complete(message, OutboxState.Done, this.clock.now());
    logger.info('Ticket delivered', { ticketId: ticket.id, attempts: message.attempts });
    return completed ? 'sent' : 'lost-claim';
  }

  private async skip(message: OutboxMessageRecord, note: string): Promise<DispatchOutcome> {
    logger.info('Ticket delivery skipped', { ticketId: message.ticketId, note });
    const completed = await this.outbox.complete(
      message,
      OutboxState.Skipped,
      this.clock.now(),
      note,
    );
    return completed ? 'skipped' : 'lost-claim';
  }
}
