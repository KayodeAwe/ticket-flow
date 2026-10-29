/**
 * Builds the real application modules against a fresh database, with the two things a test
 * must control swapped out: the clock and the mailer.
 */

import { randomUUID } from 'node:crypto';

import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection, Model } from 'mongoose';
import { inject } from 'vitest';

import { ApplicationModule } from '../../src/application/application.module.js';
import { DispatchModule } from '../../src/application/dispatch.module.js';
import { Clock, TicketMailer, type TicketEmail } from '../../src/application/ports.js';
import { Role } from '../../src/domain/types.js';
import {
  EVENT_MODEL,
  USER_MODEL,
  type EventDoc,
  type UserDoc,
} from '../../src/infrastructure/persistence/schemas.js';

export class FakeClock extends Clock {
  constructor(private current: Date) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = date;
  }
}

/** Records what would have been sent. `failWith` makes the next sends throw. */
export class FakeMailer extends TicketMailer {
  readonly sent: TicketEmail[] = [];
  failWith: Error | null = null;

  async send(email: TicketEmail): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(email);
  }
}

export const HOUR = 60 * 60 * 1000;

/** Doors opened an hour before "now" and the event runs for another five. */
export const NOW = new Date('2026-07-01T19:00:00.000Z');

export interface Harness {
  readonly module: TestingModule;
  readonly clock: FakeClock;
  readonly mailer: FakeMailer;
  readonly connection: Connection;
  model<T>(name: string): Model<T>;
  close(): Promise<void>;
}

/**
 * Build a harness. `imports` defaults to the use-case modules; the HTTP tests pass their own
 * root module instead.
 */
export async function createHarness(
  imports: NonNullable<Parameters<typeof Test.createTestingModule>[0]['imports']> = [
    ApplicationModule,
    DispatchModule,
  ],
): Promise<Harness> {
  const clock = new FakeClock(NOW);
  const mailer = new FakeMailer();

  const module = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(inject('mongoUri'), { dbName: `test_${randomUUID().slice(0, 8)}` }),
      ...imports,
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(TicketMailer)
    .useValue(mailer)
    .compile();

  await module.init();

  const connection = module.get<Connection>(getConnectionToken());

  return {
    module,
    clock,
    mailer,
    connection,
    model: <T>(name: string) => module.get<Model<T>>(getModelToken(name)),
    async close() {
      await connection.dropDatabase();
      await module.close();
    },
  };
}

export interface World {
  organizerId: string;
  otherOrganizerId: string;
  eventId: string;
  otherEventId: string;
  scannerA: { role: typeof Role.Scanner; id: string; eventId: string; gate: string };
  scannerB: { role: typeof Role.Scanner; id: string; eventId: string; gate: string };
  otherEventScanner: { role: typeof Role.Scanner; id: string; eventId: string; gate: string };
  organizer: { role: typeof Role.Organizer; id: string };
  otherOrganizer: { role: typeof Role.Organizer; id: string };
}

/** Two organizers, one event each, two scanners on the first event and one on the second. */
export async function seedWorld(harness: Harness, passwordHash = 'not-a-real-hash'): Promise<World> {
  const users = harness.model<UserDoc>(USER_MODEL);
  const events = harness.model<EventDoc>(EVENT_MODEL);

  const [organizer, otherOrganizer] = await users.create([
    { email: 'olivia@example.test', name: 'Olivia', role: Role.Organizer, passwordHash },
    { email: 'omar@example.test', name: 'Omar', role: Role.Organizer, passwordHash },
  ]);
  if (!organizer || !otherOrganizer) throw new Error('Seeding organizers failed.');

  const [event, otherEvent] = await events.create([
    {
      name: 'Harbour Lights',
      venue: 'Pier 4',
      doorsOpenAt: new Date(NOW.getTime() - HOUR),
      endsAt: new Date(NOW.getTime() + 5 * HOUR),
      organizerId: organizer._id,
    },
    {
      name: 'Winter Jazz',
      venue: 'Old Town Hall',
      doorsOpenAt: new Date(NOW.getTime() - HOUR),
      endsAt: new Date(NOW.getTime() + 5 * HOUR),
      organizerId: otherOrganizer._id,
    },
  ]);
  if (!event || !otherEvent) throw new Error('Seeding events failed.');

  const [a, b, c] = await users.create([
    { email: 'sam@example.test', name: 'Sam', role: Role.Scanner, passwordHash, eventId: event._id, gate: 'Gate A' },
    { email: 'gus@example.test', name: 'Gus', role: Role.Scanner, passwordHash, eventId: event._id, gate: 'Gate B' },
    { email: 'wen@example.test', name: 'Wen', role: Role.Scanner, passwordHash, eventId: otherEvent._id, gate: 'Main' },
  ]);
  if (!a || !b || !c) throw new Error('Seeding scanners failed.');

  const scanner = (doc: typeof a, gate: string, eventId: string) => ({
    role: Role.Scanner,
    id: doc._id.toString(),
    eventId,
    gate,
  });

  return {
    organizerId: organizer._id.toString(),
    otherOrganizerId: otherOrganizer._id.toString(),
    eventId: event._id.toString(),
    otherEventId: otherEvent._id.toString(),
    organizer: { role: Role.Organizer, id: organizer._id.toString() },
    otherOrganizer: { role: Role.Organizer, id: otherOrganizer._id.toString() },
    scannerA: scanner(a, 'Gate A', event._id.toString()),
    scannerB: scanner(b, 'Gate B', event._id.toString()),
    otherEventScanner: scanner(c, 'Main', otherEvent._id.toString()),
  };
}
