import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TicketsService } from '../src/application/tickets.service.js';
import { DomainErrorCode } from '../src/domain/errors.js';
import { TicketStatus } from '../src/domain/types.js';
import { OutboxRepository } from '../src/infrastructure/persistence/outbox.repository.js';
import { TicketRepository } from '../src/infrastructure/persistence/ticket.repository.js';
import { UnitOfWork } from '../src/infrastructure/persistence/unit-of-work.js';
import {
  AUDIT_EVENT_MODEL,
  OUTBOX_MODEL,
  TICKET_MODEL,
  type AuditEventDoc,
  type OutboxMessageDoc,
  type TicketDoc,
} from '../src/infrastructure/persistence/schemas.js';
import { createHarness, seedWorld, type Harness, type World } from './support/harness.js';

let harness: Harness;
let world: World;
let tickets: TicketsService;

beforeAll(async () => {
  harness = await createHarness();
  world = await seedWorld(harness);
  tickets = harness.module.get(TicketsService);
});

afterAll(async () => {
  await harness.close();
});

const holder = { holderName: 'Ada Holder', holderEmail: 'ada.holder@example.test' };

describe('issuing a ticket', () => {
  it('writes the ticket, its ISSUE audit event and its outbox message together', async () => {
    const ticket = await tickets.issue({ actor: world.organizer, eventId: world.eventId, ...holder });

    expect(ticket.status).toBe(TicketStatus.Issued);
    expect(ticket.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/);

    const audit = await harness.model<AuditEventDoc>(AUDIT_EVENT_MODEL).find({ ticketId: ticket.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'ISSUE',
      fromStatus: null,
      toStatus: TicketStatus.Issued,
      actorId: world.organizerId,
    });

    const outbox = await harness.model<OutboxMessageDoc>(OUTBOX_MODEL).find({ ticketId: ticket.id });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: 'TICKET_ISSUED', state: 'PENDING', attempts: 0 });
  });

  it("returns NOT_FOUND for another organizer's event and writes nothing", async () => {
    const before = await harness.model<TicketDoc>(TICKET_MODEL).countDocuments();

    await expect(
      tickets.issue({ actor: world.otherOrganizer, eventId: world.eventId, ...holder }),
    ).rejects.toMatchObject({ code: DomainErrorCode.NotFound });

    expect(await harness.model<TicketDoc>(TICKET_MODEL).countDocuments()).toBe(before);
  });

  it('rolls all three writes back when any one of them fails', async () => {
    const count = async () => ({
      tickets: await harness.model<TicketDoc>(TICKET_MODEL).countDocuments(),
      audit: await harness.model<AuditEventDoc>(AUDIT_EVENT_MODEL).countDocuments(),
      outbox: await harness.model<OutboxMessageDoc>(OUTBOX_MODEL).countDocuments(),
    });
    const before = await count();

    // Fail the last write of the three. If the ticket and audit event were written outside
    // the transaction, they would survive this and the ticket would never be delivered.
    const outbox = harness.module.get(OutboxRepository);
    const spy = vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('disk full'));

    try {
      await expect(
        tickets.issue({ actor: world.organizer, eventId: world.eventId, ...holder }),
      ).rejects.toThrow('disk full');
    } finally {
      spy.mockRestore();
    }

    expect(await count()).toEqual(before);
  });

  it('gives every ticket a different code', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      codes.add((await tickets.issue({ actor: world.organizer, eventId: world.eventId, ...holder })).code);
    }
    expect(codes.size).toBe(20);
  });
});

describe('cancelling a ticket', () => {
  it('cancels and records who, why, and from which status', async () => {
    const ticket = await tickets.issue({ actor: world.organizer, eventId: world.eventId, ...holder });

    const cancelled = await tickets.cancel({
      actor: world.organizer,
      ticketId: ticket.id,
      reason: 'Refunded at the box office',
    });
    expect(cancelled.status).toBe(TicketStatus.Cancelled);

    const trail = await tickets.auditTrail(ticket.id, world.organizer);
    expect(trail.map((event) => `${event.fromStatus ?? '∅'} → ${event.toStatus}`)).toEqual([
      '∅ → ISSUED',
      'ISSUED → CANCELLED',
    ]);
    expect(trail[1]).toMatchObject({ action: 'CANCEL', reason: 'Refunded at the box office' });
  });

  it("returns NOT_FOUND to another event's organizer rather than admitting the ticket exists", async () => {
    const ticket = await tickets.issue({ actor: world.organizer, eventId: world.eventId, ...holder });

    await expect(
      tickets.cancel({ actor: world.otherOrganizer, ticketId: ticket.id }),
    ).rejects.toMatchObject({ code: DomainErrorCode.NotFound });
    await expect(tickets.get(ticket.id, world.otherOrganizer)).rejects.toMatchObject({
      code: DomainErrorCode.NotFound,
    });
    await expect(tickets.auditTrail(ticket.id, world.otherOrganizer)).rejects.toMatchObject({
      code: DomainErrorCode.NotFound,
    });
  });

  it('refuses to cancel twice, and leaves one CANCEL in the trail', async () => {
    const ticket = await tickets.issue({ actor: world.organizer, eventId: world.eventId, ...holder });
    await tickets.cancel({ actor: world.organizer, ticketId: ticket.id });

    await expect(tickets.cancel({ actor: world.organizer, ticketId: ticket.id })).rejects.toMatchObject({
      code: DomainErrorCode.TicketCancelled,
    });

    const trail = await tickets.auditTrail(ticket.id, world.organizer);
    expect(trail.filter((event) => event.action === 'CANCEL')).toHaveLength(1);
  });
});

describe('the conditional write', () => {
  /**
   * The double-scan test passes even without this guard, because the transaction retry
   * re-reads the ticket first. This pins the guard on its own: a write decided against a
   * status the ticket no longer has must match nothing.
   */
  it('refuses a transition decided against a status the ticket no longer has', async () => {
    const ticket = await tickets.issue({ actor: world.organizer, eventId: world.eventId, ...holder });
    await tickets.cancel({ actor: world.organizer, ticketId: ticket.id });

    const repository = harness.module.get(TicketRepository);
    const stale = await harness.module
      .get(UnitOfWork)
      .run((tx) => repository.applyTransition(ticket.id, TicketStatus.Issued, TicketStatus.Sent, tx));

    expect(stale).toBeNull();
    expect((await tickets.get(ticket.id, world.organizer)).ticket.status).toBe(TicketStatus.Cancelled);
  });
});

describe('the audit trail', () => {
  it('cannot be edited or deleted', async () => {
    const ticket = await tickets.issue({ actor: world.organizer, eventId: world.eventId, ...holder });
    const audit = harness.model<AuditEventDoc>(AUDIT_EVENT_MODEL);

    await expect(
      audit.updateOne({ ticketId: ticket.id }, { $set: { actorId: 'someone-else' } }),
    ).rejects.toThrow(/append-only/);
    await expect(audit.deleteMany({ ticketId: ticket.id })).rejects.toThrow(/append-only/);

    const [event] = await audit.find({ ticketId: ticket.id });
    if (!event) throw new Error('Expected the ISSUE event.');
    event.actorId = 'someone-else';
    await expect(event.save()).rejects.toThrow(/append-only/);
  });
});
