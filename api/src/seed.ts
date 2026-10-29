/**
 * Seed a demo dataset so that `docker compose up` gives a reviewer something to sign in to.
 *
 * Idempotent: re-running replaces the demo users and events but never touches tickets, audit
 * events or outbox messages, so restarting the stack does not wipe a demo in progress — and
 * nothing here could delete audit history, which the model forbids anyway.
 *
 * Event times are relative to when the seed runs, so the demo always has one event whose doors
 * are open (scans succeed) and one whose doors open in two weeks (scans are refused).
 */

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { nestLogger, SeedModule } from './app.js';
import { Role } from './domain/types.js';
import { EventRepository } from './infrastructure/persistence/event.repository.js';
import { UserRepository } from './infrastructure/persistence/user.repository.js';
import { hashPassword } from './infrastructure/security/passwords.js';
import { logger } from './lib/logger.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function seed(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to seed demo accounts in production.');
  }

  const password = process.env['SEED_PASSWORD'];
  if (!password || password.length < 8) {
    throw new Error('SEED_PASSWORD must be set to at least 8 characters to seed demo users.');
  }
  if (!process.env['MONGODB_URI']) throw new Error('MONGODB_URI must be set to seed.');

  const app = await NestFactory.createApplicationContext(SeedModule, { logger: nestLogger });
  const users = app.get(UserRepository);
  const events = app.get(EventRepository);

  const passwordHash = await hashPassword(password);
  const now = Date.now();

  // example.test is a reserved domain and can never belong to anyone. No real names, no real
  // addresses: this file is public.
  const organizer = await users.upsert({
    email: 'olivia.organizer@example.test',
    name: 'Olivia Organizer',
    role: Role.Organizer,
    passwordHash,
  });

  const festival = await events.upsertByName({
    name: 'Harbour Lights Festival',
    venue: 'Pier 4 Arena',
    doorsOpenAt: new Date(now - 2 * HOUR),
    endsAt: new Date(now + 30 * DAY),
    organizerId: organizer.id,
  });

  const jazz = await events.upsertByName({
    name: 'Winter Jazz Night',
    venue: 'Old Town Hall',
    doorsOpenAt: new Date(now + 14 * DAY),
    endsAt: new Date(now + 14 * DAY + 5 * HOUR),
    organizerId: organizer.id,
  });

  const scanners = [
    { email: 'sam.scanner@example.test', name: 'Sam Scanner', eventId: festival.id, gate: 'Gate A' },
    { email: 'gus.scanner@example.test', name: 'Gus Scanner', eventId: festival.id, gate: 'Gate B' },
    { email: 'wen.scanner@example.test', name: 'Wen Scanner', eventId: jazz.id, gate: 'Main entrance' },
  ];
  for (const scanner of scanners) {
    await users.upsert({ ...scanner, role: Role.Scanner, passwordHash });
  }

  logger.info('Seed complete', {
    events: [festival.name, jazz.name],
    users: [organizer.email, ...scanners.map((scanner) => scanner.email)],
  });

  await app.close();
}

seed().catch((error: unknown) => {
  logger.error('Seed failed', { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
