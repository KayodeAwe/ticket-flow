import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ScansService } from '../src/application/scans.service.js';
import { TicketsService } from '../src/application/tickets.service.js';
import { DomainError, DomainErrorCode } from '../src/domain/errors.js';
import { formatTicketCode } from '../src/domain/ticket-code.js';
import { TicketStatus } from '../src/domain/types.js';
import { createHarness, HOUR, NOW, seedWorld, type Harness, type World } from './support/harness.js';

let harness: Harness;
let world: World;
let tickets: TicketsService;
let scans: ScansService;

beforeAll(async () => {
  harness = await createHarness();
  world = await seedWorld(harness);
  tickets = harness.module.get(TicketsService);
  scans = harness.module.get(ScansService);
});

afterAll(async () => {
  await harness.close();
});

async function issue(eventId = world.eventId, actor = world.organizer) {
  return tickets.issue({
    actor,
    eventId,
    holderName: 'Ada Holder',
    holderEmail: 'ada.holder@example.test',
  });
}

describe('scanning at the gate', () => {
  it('admits a valid ticket once and records the gate', async () => {
    const ticket = await issue();

    const admission = await scans.redeem(ticket.code, world.scannerA);
    expect(admission.ticket.status).toBe(TicketStatus.Redeemed);
    expect(admission.ticket.redemption).toEqual({ at: NOW, gate: 'Gate A' });

    const trail = await tickets.auditTrail(ticket.id, world.organizer);
    expect(trail.at(-1)).toMatchObject({ action: 'REDEEM', gate: 'Gate A', actorId: world.scannerA.id });
  });

  it('accepts the code as printed: grouped, lower case, with look-alike characters', async () => {
    const ticket = await issue();
    const typed = formatTicketCode(ticket.code).toLowerCase().replaceAll('0', 'o').replaceAll('1', 'l');

    await expect(scans.redeem(typed, world.scannerA)).resolves.toMatchObject({
      ticket: { id: ticket.id, status: TicketStatus.Redeemed },
    });
  });

  it('refuses a second scan and says where the first one happened', async () => {
    const ticket = await issue();
    await scans.redeem(ticket.code, world.scannerA);

    await expect(scans.redeem(ticket.code, world.scannerB)).rejects.toMatchObject({
      code: DomainErrorCode.AlreadyRedeemed,
      details: { gate: 'Gate A', redeemedAt: NOW.toISOString() },
    });
  });

  it('refuses a ticket for a different event without describing it', async () => {
    const ticket = await issue(world.otherEventId, world.otherOrganizer);

    await expect(scans.redeem(ticket.code, world.scannerA)).rejects.toMatchObject({
      code: DomainErrorCode.WrongEvent,
    });
  });

  it('refuses a cancelled ticket', async () => {
    const ticket = await issue();
    await tickets.cancel({ actor: world.organizer, ticketId: ticket.id });

    await expect(scans.redeem(ticket.code, world.scannerA)).rejects.toMatchObject({
      code: DomainErrorCode.TicketCancelled,
    });
  });

  it('refuses a scan before the doors open and leaves the ticket usable', async () => {
    const ticket = await issue();

    harness.clock.set(new Date(NOW.getTime() - 2 * HOUR));
    try {
      await expect(scans.redeem(ticket.code, world.scannerA)).rejects.toMatchObject({
        code: DomainErrorCode.OutsideEntryWindow,
      });
    } finally {
      harness.clock.set(NOW);
    }

    await expect(scans.redeem(ticket.code, world.scannerA)).resolves.toBeDefined();
  });

  it('returns NOT_FOUND for a code that matches nothing, and for one that cannot be a code', async () => {
    await expect(scans.redeem('0000-0000-0000-0000-0000', world.scannerA)).rejects.toMatchObject({
      code: DomainErrorCode.NotFound,
    });
    await expect(scans.redeem('not a code', world.scannerA)).rejects.toMatchObject({
      code: DomainErrorCode.NotFound,
    });
  });
});

describe('the double scan', () => {
  /**
   * Two scanners at two entrances read the same ticket in the same moment — a shared
   * screenshot, a forwarded email. Exactly one person gets in, and the trail shows one
   * redemption. Run several times, because a race test that passes once has proved little.
   */
  for (let round = 1; round <= 5; round += 1) {
    it(`admits exactly one of two concurrent scans (round ${round})`, async () => {
      const ticket = await issue();

      const results = await Promise.allSettled([
        scans.redeem(ticket.code, world.scannerA),
        scans.redeem(ticket.code, world.scannerB),
      ]);

      const admitted = results.filter((result) => result.status === 'fulfilled');
      const refused = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));

      expect(admitted).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]).toBeInstanceOf(DomainError);
      // The loser is told the ticket was already used — and where — not merely "conflict":
      // the transaction retry re-reads the ticket and the state machine explains it.
      expect(refused[0]).toMatchObject({ code: DomainErrorCode.AlreadyRedeemed });

      const trail = await tickets.auditTrail(ticket.id, world.organizer);
      expect(trail.filter((event) => event.action === 'REDEEM')).toHaveLength(1);
    });
  }
});
