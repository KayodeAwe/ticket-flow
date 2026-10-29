import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DispatchService, MAX_ATTEMPTS } from '../src/application/dispatch.service.js';
import { ScansService } from '../src/application/scans.service.js';
import { TicketsService } from '../src/application/tickets.service.js';
import { TicketStatus } from '../src/domain/types.js';
import {
  OUTBOX_MODEL,
  TICKET_MODEL,
  type OutboxMessageDoc,
  type TicketDoc,
} from '../src/infrastructure/persistence/schemas.js';
import { createHarness, NOW, seedWorld, type Harness, type World } from './support/harness.js';

let harness: Harness;
let world: World;
let tickets: TicketsService;
let dispatch: DispatchService;

beforeAll(async () => {
  harness = await createHarness();
  world = await seedWorld(harness);
  tickets = harness.module.get(TicketsService);
  dispatch = harness.module.get(DispatchService);
});

afterEach(async () => {
  // Each test drains what it created, so one test's leftovers are never another's input.
  harness.mailer.failWith = null;
  harness.mailer.sent.length = 0;
  harness.clock.set(NOW);
  await harness.model<OutboxMessageDoc>(OUTBOX_MODEL).deleteMany({});
});

afterAll(async () => {
  await harness.close();
});

async function issue() {
  return tickets.issue({
    actor: world.organizer,
    eventId: world.eventId,
    holderName: 'Ada Holder',
    holderEmail: 'ada.holder@example.test',
  });
}

const outboxFor = async (ticketId: string) => {
  const [message] = await harness.model<OutboxMessageDoc>(OUTBOX_MODEL).find({ ticketId });
  if (!message) throw new Error('Expected an outbox message.');
  return message;
};

describe('the dispatcher', () => {
  it('is idle when there is nothing to send', async () => {
    expect(await dispatch.processNext()).toBe('idle');
  });

  it('emails an issued ticket, marks it SENT, and records the delivery', async () => {
    const ticket = await issue();

    expect(await dispatch.processNext()).toBe('sent');

    expect(harness.mailer.sent).toHaveLength(1);
    expect(harness.mailer.sent[0]).toMatchObject({
      ticketId: ticket.id,
      to: 'ada.holder@example.test',
      eventName: 'Harbour Lights',
      code: ticket.code,
    });

    const after = await tickets.get(ticket.id, world.organizer);
    expect(after.ticket.status).toBe(TicketStatus.Sent);

    const trail = await tickets.auditTrail(ticket.id, world.organizer);
    expect(trail.at(-1)).toMatchObject({
      action: 'SEND',
      actorRole: 'SYSTEM',
      fromStatus: 'ISSUED',
      toStatus: 'SENT',
    });

    expect(await outboxFor(ticket.id)).toMatchObject({ state: 'DONE', attempts: 1 });
  });

  it('does not email a ticket that was cancelled before delivery', async () => {
    const ticket = await issue();
    await tickets.cancel({ actor: world.organizer, ticketId: ticket.id });

    expect(await dispatch.processNext()).toBe('skipped');
    expect(harness.mailer.sent).toHaveLength(0);
    expect(await outboxFor(ticket.id)).toMatchObject({ state: 'SKIPPED', note: 'Not sent: TICKET_CANCELLED' });
  });

  it('does not email a ticket that was already used at the gate', async () => {
    const ticket = await issue();
    await harness.module.get(ScansService).redeem(ticket.code, world.scannerA);

    expect(await dispatch.processNext()).toBe('skipped');
    expect(harness.mailer.sent).toHaveLength(0);
  });

  it('retries with backoff when the mail server refuses, and leaves the ticket ISSUED', async () => {
    const ticket = await issue();
    harness.mailer.failWith = new Error('421 Service not available');

    expect(await dispatch.processNext()).toBe('retry');

    const message = await outboxFor(ticket.id);
    expect(message).toMatchObject({ state: 'PENDING', attempts: 1, lastError: '421 Service not available' });
    expect(message.availableAt.getTime()).toBeGreaterThan(NOW.getTime());

    // Not yet due, so not claimed again...
    expect(await dispatch.processNext()).toBe('idle');

    // ...until the backoff has passed and the server is back.
    harness.mailer.failWith = null;
    harness.clock.set(message.availableAt);
    expect(await dispatch.processNext()).toBe('sent');
    expect((await tickets.get(ticket.id, world.organizer)).ticket.status).toBe(TicketStatus.Sent);
  });

  it(`gives up after ${MAX_ATTEMPTS} attempts and marks the message FAILED`, async () => {
    const ticket = await issue();
    harness.mailer.failWith = new Error('550 Mailbox unavailable');

    let outcome = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      harness.clock.set((await outboxFor(ticket.id)).availableAt);
      outcome = await dispatch.processNext();
    }

    expect(outcome).toBe('failed');
    expect(await outboxFor(ticket.id)).toMatchObject({ state: 'FAILED', attempts: MAX_ATTEMPTS });
  });

  it('does not send twice after a crash between marking SENT and completing the message', async () => {
    const ticket = await issue();
    expect(await dispatch.processNext()).toBe('sent');

    // Simulate the crash: the ticket is SENT, but the message never got marked DONE and its
    // lease has since run out.
    await harness
      .model<OutboxMessageDoc>(OUTBOX_MODEL)
      .updateOne({ ticketId: ticket.id }, { $set: { state: 'PROCESSING', leaseUntil: NOW } });

    expect(await dispatch.processNext()).toBe('skipped');
    expect(harness.mailer.sent).toHaveLength(1);
  });

  it('hands each message to exactly one of several concurrent dispatchers', async () => {
    const ticket = await issue();

    const outcomes = await Promise.all([
      dispatch.processNext(),
      dispatch.processNext(),
      dispatch.processNext(),
    ]);

    expect(outcomes.filter((outcome) => outcome === 'sent')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'idle')).toHaveLength(2);
    expect(harness.mailer.sent.filter((email) => email.ticketId === ticket.id)).toHaveLength(1);
    expect(await harness.model<TicketDoc>(TICKET_MODEL).countDocuments({ _id: ticket.id, status: 'SENT' })).toBe(1);
  });
});
