/**
 * What the person at the gate sees after a scan.
 *
 * A pure function, separate from the page, because this is the part that must be right: the
 * difference between "already used at Gate A, 19:02" and "wrong event" decides whether someone
 * calls a supervisor or redirects a confused guest to the right hall. The server decides; this
 * only turns its answer into words a person can act on in two seconds.
 */

import { ApiError } from '../api/client';
import type { Admission } from '../api/types';
import { formatDateTime, formatTime } from '../format';

export type ScanTone = 'admit' | 'deny' | 'error';

export interface ScanResult {
  readonly tone: ScanTone;
  readonly title: string;
  readonly detail: string;
}

export function describeAdmission(admission: Admission): ScanResult {
  return { tone: 'admit', title: 'Admit', detail: admission.holderName };
}

export function describeRefusal(error: unknown): ScanResult {
  if (!(error instanceof ApiError)) {
    return { tone: 'error', title: 'Could not check ticket', detail: 'Try again, or check the code by hand.' };
  }

  switch (error.code) {
    case 'ALREADY_REDEEMED': {
      const { gate, redeemedAt } = error.details;
      const where = gate ? ` at ${gate}` : '';
      const when = redeemedAt ? `, ${formatTime(redeemedAt)}` : '';
      return { tone: 'deny', title: 'Already used', detail: `Scanned${where}${when}.` };
    }
    case 'TICKET_CANCELLED':
      return { tone: 'deny', title: 'Cancelled', detail: 'This ticket was cancelled. Send the holder to the box office.' };
    case 'WRONG_EVENT':
      return { tone: 'deny', title: 'Wrong event', detail: 'This ticket is for a different event.' };
    case 'OUTSIDE_ENTRY_WINDOW': {
      const { doorsOpenAt } = error.details;
      const opens = doorsOpenAt && Date.parse(doorsOpenAt) > Date.now() ? ` Doors open ${formatDateTime(doorsOpenAt)}.` : '';
      return { tone: 'deny', title: 'Not valid now', detail: `${error.message}${opens}` };
    }
    case 'NOT_FOUND':
      return { tone: 'deny', title: 'Unknown code', detail: 'No ticket has this code. Check it and try again.' };
    default:
      return { tone: 'error', title: 'Could not check ticket', detail: error.message };
  }
}
