import { describe, expect, it } from 'vitest';

import {
  encodeTicketCode,
  formatTicketCode,
  normalizeTicketCode,
  TICKET_CODE_BYTES,
} from './ticket-code.js';

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{20}$/;

describe('encodeTicketCode', () => {
  it('needs 13 bytes for 100 bits', () => {
    expect(TICKET_CODE_BYTES).toBe(13);
  });

  it('produces 20 Crockford base32 characters', () => {
    const bytes = Uint8Array.from({ length: TICKET_CODE_BYTES }, (_, i) => (i * 37 + 11) % 256);
    expect(encodeTicketCode(bytes)).toMatch(CROCKFORD);
  });

  it('is a pure function of its input bytes', () => {
    const bytes = new Uint8Array(TICKET_CODE_BYTES).fill(0xa5);
    expect(encodeTicketCode(bytes)).toBe(encodeTicketCode(new Uint8Array(bytes)));
  });

  it('maps all-zero and all-one bits to the ends of the alphabet', () => {
    expect(encodeTicketCode(new Uint8Array(TICKET_CODE_BYTES))).toBe('0'.repeat(20));
    expect(encodeTicketCode(new Uint8Array(TICKET_CODE_BYTES).fill(0xff))).toBe('Z'.repeat(20));
  });

  it('refuses too few bytes rather than producing a short, weaker code', () => {
    expect(() => encodeTicketCode(new Uint8Array(TICKET_CODE_BYTES - 1))).toThrow(RangeError);
  });
});

describe('formatTicketCode', () => {
  it('groups a code in fours for reading aloud', () => {
    expect(formatTicketCode('K7QM3D9XA2B4C6D8E0F1')).toBe('K7QM-3D9X-A2B4-C6D8-E0F1');
  });
});

describe('normalizeTicketCode', () => {
  const CODE = 'K7QM3D9XA2B4C6D8E0F1';

  it('accepts the formatted form, lower case and stray spaces', () => {
    expect(normalizeTicketCode('k7qm-3d9x-a2b4-c6d8-e0f1')).toBe(CODE);
    expect(normalizeTicketCode(' K7QM 3D9X A2B4 C6D8 E0F1 ')).toBe(CODE);
  });

  it('reads the characters people confuse as the ones they meant', () => {
    expect(normalizeTicketCode('K7QM3D9XA2B4C6D8EOFI')).toBe(CODE);
    expect(normalizeTicketCode('K7QM3D9XA2B4C6D8EoFl')).toBe(CODE);
  });

  it('rejects anything that cannot be a code', () => {
    expect(normalizeTicketCode('')).toBeNull();
    expect(normalizeTicketCode(CODE.slice(1))).toBeNull();
    expect(normalizeTicketCode(`${CODE}0`)).toBeNull();
    expect(normalizeTicketCode('K7QM3D9XA2B4C6D8E0FU')).toBeNull();
    expect(normalizeTicketCode('K7QM3D9XA2B4C6D8E0F!')).toBeNull();
  });
});
