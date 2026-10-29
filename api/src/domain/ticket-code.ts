/**
 * Ticket codes: what goes into the QR code and what a scanner can type by hand.
 *
 * A code is 20 characters of Crockford base32 — 100 bits. That is far beyond guessing at
 * any rate a scan endpoint will ever accept, which matters because a guessable code is a free
 * ticket. Crockford's alphabet leaves out I, L, O and U, so a code read aloud or typed from a
 * crumpled printout survives the usual confusions.
 *
 * Pure on purpose: the random bytes are passed in. The domain never reads a random source, so
 * encoding can be tested with fixed bytes.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 20;
const BITS_PER_CHAR = 5;

/** The number of random bytes `encodeTicketCode` needs: 100 bits, rounded up. */
export const TICKET_CODE_BYTES = Math.ceil((CODE_LENGTH * BITS_PER_CHAR) / 8);

/** Encode random bytes as a 20-character code. Extra bits beyond 100 are discarded. */
export function encodeTicketCode(bytes: Uint8Array): string {
  if (bytes.length < TICKET_CODE_BYTES) {
    throw new RangeError(`A ticket code needs at least ${TICKET_CODE_BYTES} random bytes.`);
  }

  let code = '';
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= BITS_PER_CHAR && code.length < CODE_LENGTH) {
      bits -= BITS_PER_CHAR;
      code += ALPHABET.charAt((buffer >> bits) & 0b11111);
    }

    // Keep only the bits not yet consumed, so the buffer never grows past 13 bits.
    buffer &= (1 << bits) - 1;
    if (code.length === CODE_LENGTH) break;
  }

  return code;
}

/** `K7QM3D9XA2B4C6D8E0F1` → `K7QM-3D9X-A2B4-C6D8-E0F1`, for humans. */
export function formatTicketCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/**
 * Turn whatever a scanner typed or scanned into a canonical code, or null if it cannot be one.
 *
 * Case, spaces and dashes are ignored, and the characters Crockford base32 excludes are read
 * as the ones they are mistaken for: I and L as 1, O as 0. U is not mapped — it is reserved in
 * Crockford's scheme and has no look-alike in the alphabet — so it makes a code invalid.
 */
export function normalizeTicketCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

  if (code.length !== CODE_LENGTH) return null;
  for (const char of code) {
    if (!ALPHABET.includes(char)) return null;
  }
  return code;
}
