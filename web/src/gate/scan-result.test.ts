import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/client';
import { describeAdmission, describeRefusal } from './scan-result';

const refusal = (code: string, details: Record<string, string> = {}, message = 'Refused.') =>
  describeRefusal(new ApiError(409, code, message, details));

describe('describeAdmission', () => {
  it('admits by name', () => {
    expect(
      describeAdmission({
        admitted: true,
        ticketId: 't1',
        holderName: 'Ada Holder',
        eventName: 'Harbour Lights',
        gate: 'Gate A',
        redeemedAt: '2026-07-01T19:02:00.000Z',
      }),
    ).toEqual({ tone: 'admit', title: 'Admit', detail: 'Ada Holder' });
  });
});

describe('describeRefusal', () => {
  it('says where an already-used ticket was used', () => {
    const result = refusal('ALREADY_REDEEMED', { gate: 'Gate A', redeemedAt: '2026-07-01T19:02:00.000Z' });
    expect(result.tone).toBe('deny');
    expect(result.title).toBe('Already used');
    expect(result.detail).toContain('at Gate A');
  });

  it('still reads sensibly when the server sends no details', () => {
    expect(refusal('ALREADY_REDEEMED').detail).toBe('Scanned.');
  });

  it('gives each refusal its own words, so staff know what to do next', () => {
    const titles = ['TICKET_CANCELLED', 'WRONG_EVENT', 'OUTSIDE_ENTRY_WINDOW', 'NOT_FOUND'].map(
      (code) => refusal(code).title,
    );
    expect(new Set(titles).size).toBe(titles.length);
    for (const code of ['TICKET_CANCELLED', 'WRONG_EVENT', 'OUTSIDE_ENTRY_WINDOW', 'NOT_FOUND']) {
      expect(refusal(code).tone).toBe('deny');
    }
  });

  it('says when the doors open for an early scan', () => {
    const result = refusal(
      'OUTSIDE_ENTRY_WINDOW',
      { doorsOpenAt: '2999-01-01T18:00:00.000Z', endsAt: '2999-01-01T23:00:00.000Z' },
      'Doors are not open yet for this event.',
    );
    expect(result.detail).toMatch(/^Doors are not open yet for this event\. Doors open /);
  });

  it('never shows "admit" for an error it does not recognise', () => {
    expect(refusal('SOMETHING_NEW').tone).toBe('error');
    expect(describeRefusal(new Error('boom')).tone).toBe('error');
  });
});
