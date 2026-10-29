/**
 * The HTTP contract, through the real Nest app: guard, filter, validation, status codes and
 * error shapes. Every endpoint is called authorised and unauthorised.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/infrastructure/security/passwords.js';
import { createHarness, seedWorld, type HttpHarness, type World } from './support/harness.js';

const PASSWORD = 'correct horse battery staple';

let harness: HttpHarness;
let world: World;
const tokens: Record<'olivia' | 'omar' | 'sam' | 'gus' | 'wen', string> = {
  olivia: '',
  omar: '',
  sam: '',
  gus: '',
  wen: '',
};

const api = () => request(harness.app.getHttpServer());
const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });

async function login(email: string): Promise<string> {
  const response = await api().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
  return response.body.token;
}

async function issueTicket(): Promise<{ id: string; code: string }> {
  const response = await api()
    .post(`/api/events/${world.eventId}/tickets`)
    .set(as('olivia'))
    .send({ holderName: 'Ada Holder', holderEmail: 'ada.holder@example.test' })
    .expect(201);
  return response.body.ticket;
}

beforeAll(async () => {
  harness = await createHarness({ http: true });
  world = await seedWorld(harness, await hashPassword(PASSWORD));

  for (const who of Object.keys(tokens) as (keyof typeof tokens)[]) {
    tokens[who] = await login(`${who}@example.test`);
  }
});

afterAll(async () => {
  await harness.close();
});

describe('GET /api/health', () => {
  it('is public and reports the delivery backlog', async () => {
    const response = await api().get('/api/health').expect(200);
    expect(response.body).toEqual({
      status: 'ok',
      outbox: { pending: expect.any(Number), failed: 0, oldestPendingSeconds: expect.toBeOneOf([null, expect.any(Number)]) },
    });
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token and the user, never the password hash', async () => {
    const response = await api()
      .post('/api/auth/login')
      .send({ email: 'sam@example.test', password: PASSWORD })
      .expect(200);

    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({ role: 'SCANNER', gate: 'Gate A', eventId: world.eventId });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await api()
      .post('/api/auth/login')
      .send({ email: 'sam@example.test', password: 'nope' })
      .expect(401);
    const unknown = await api()
      .post('/api/auth/login')
      .send({ email: 'nobody@example.test', password: 'nope' })
      .expect(401);

    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
    });
  });

  it('validates the body', async () => {
    const response = await api().post('/api/auth/login').send({ email: 'not-an-email' }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('authentication', () => {
  it('closes every route that did not opt out', async () => {
    const missing = await api().get('/api/events').expect(401);
    expect(missing.body.error.code).toBe('UNAUTHENTICATED');

    await api().get('/api/events').set({ Authorization: 'Bearer not.a.token' }).expect(401);
    await api().post('/api/scans').send({ code: 'x' }).expect(401);
  });

  it('answers unknown routes and malformed JSON in the standard error shape', async () => {
    const notFound = await api().get('/api/nope').set(as('olivia')).expect(404);
    expect(notFound.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });

    const malformed = await api()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(malformed.body.error.code).toEqual(expect.any(String));
    expect(malformed.body).not.toHaveProperty('stack');
  });
});

describe('GET /api/events', () => {
  it('shows an organizer their own events with ticket counts', async () => {
    const response = await api().get('/api/events').set(as('olivia')).expect(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      id: world.eventId,
      ticketCounts: { ISSUED: expect.any(Number), SENT: expect.any(Number) },
    });
  });

  it('shows a scanner only its assigned event, without sales figures', async () => {
    const response = await api().get('/api/events').set(as('wen')).expect(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0].id).toBe(world.otherEventId);
    expect(response.body.events[0]).not.toHaveProperty('ticketCounts');
  });
});

describe('POST /api/events/:id/tickets', () => {
  it('issues a ticket for the organizer', async () => {
    const ticket = await issueTicket();
    expect(ticket).toMatchObject({ status: 'ISSUED', holderName: 'Ada Holder' });
  });

  it('refuses a scanner by role', async () => {
    const response = await api()
      .post(`/api/events/${world.eventId}/tickets`)
      .set(as('sam'))
      .send({ holderName: 'X', holderEmail: 'x@example.test' })
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it("returns 404 for another organizer's event", async () => {
    await api()
      .post(`/api/events/${world.eventId}/tickets`)
      .set(as('omar'))
      .send({ holderName: 'X', holderEmail: 'x@example.test' })
      .expect(404);
  });

  it('validates the body and the id', async () => {
    await api()
      .post(`/api/events/${world.eventId}/tickets`)
      .set(as('olivia'))
      .send({ holderName: '', holderEmail: 'not-an-email' })
      .expect(400);
    await api()
      .post('/api/events/not-an-id/tickets')
      .set(as('olivia'))
      .send({ holderName: 'X', holderEmail: 'x@example.test' })
      .expect(400);
  });
});

describe('tickets', () => {
  it('lets the organizer list, read and audit a ticket', async () => {
    const ticket = await issueTicket();

    const list = await api().get(`/api/events/${world.eventId}/tickets`).set(as('olivia')).expect(200);
    expect(list.body.tickets.map((t: { id: string }) => t.id)).toContain(ticket.id);

    const read = await api().get(`/api/tickets/${ticket.id}`).set(as('olivia')).expect(200);
    expect(read.body).toMatchObject({ ticket: { id: ticket.id, code: ticket.code }, event: { id: world.eventId } });

    const audit = await api().get(`/api/tickets/${ticket.id}/audit`).set(as('olivia')).expect(200);
    expect(audit.body.events).toHaveLength(1);
  });

  it('hides a ticket from everyone else', async () => {
    const ticket = await issueTicket();

    await api().get(`/api/tickets/${ticket.id}`).set(as('omar')).expect(404);
    await api().get(`/api/tickets/${ticket.id}/audit`).set(as('omar')).expect(404);
    await api().get(`/api/events/${world.eventId}/tickets`).set(as('omar')).expect(404);
    await api().get(`/api/tickets/${ticket.id}`).set(as('sam')).expect(403);
  });

  it('cancels once, then refuses with TICKET_CANCELLED', async () => {
    const ticket = await issueTicket();

    const cancelled = await api()
      .post(`/api/tickets/${ticket.id}/cancel`)
      .set(as('olivia'))
      .send({ reason: 'Refunded' })
      .expect(200);
    expect(cancelled.body.ticket.status).toBe('CANCELLED');

    const again = await api().post(`/api/tickets/${ticket.id}/cancel`).set(as('olivia')).expect(409);
    expect(again.body.error.code).toBe('TICKET_CANCELLED');

    await api().post(`/api/tickets/${ticket.id}/cancel`).set(as('omar')).expect(404);
  });
});

describe('POST /api/scans', () => {
  it('admits once, then refuses with where it was used', async () => {
    const ticket = await issueTicket();

    const first = await api().post('/api/scans').set(as('sam')).send({ code: ticket.code }).expect(200);
    expect(first.body).toMatchObject({ admitted: true, holderName: 'Ada Holder', gate: 'Gate A' });
    expect(first.body).not.toHaveProperty('holderEmail');

    const second = await api().post('/api/scans').set(as('gus')).send({ code: ticket.code }).expect(409);
    expect(second.body.error).toMatchObject({
      code: 'ALREADY_REDEEMED',
      details: { gate: 'Gate A', redeemedAt: expect.any(String) },
    });
  });

  it('records the gate from the token, not from the request body', async () => {
    const ticket = await issueTicket();

    await api()
      .post('/api/scans')
      .set(as('sam'))
      .send({ code: ticket.code, gate: 'VIP Lounge', eventId: world.otherEventId })
      .expect(200);

    const audit = await api().get(`/api/tickets/${ticket.id}/audit`).set(as('olivia')).expect(200);
    expect(audit.body.events.at(-1)).toMatchObject({ action: 'REDEEM', gate: 'Gate A' });
  });

  it('refuses a ticket for another event, an unknown code, and a non-scanner', async () => {
    const ticket = await issueTicket();

    const wrongEvent = await api().post('/api/scans').set(as('wen')).send({ code: ticket.code }).expect(409);
    expect(wrongEvent.body.error.code).toBe('WRONG_EVENT');

    const unknown = await api()
      .post('/api/scans')
      .set(as('sam'))
      .send({ code: '0000-0000-0000-0000-0000' })
      .expect(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');

    const organizer = await api().post('/api/scans').set(as('olivia')).send({ code: ticket.code }).expect(403);
    expect(organizer.body.error.code).toBe('FORBIDDEN_ROLE');
  });
});
