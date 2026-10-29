/**
 * The API's response shapes, as the client relies on them. Dates arrive as ISO strings.
 */

export type Role = 'ORGANIZER' | 'SCANNER';
export type TicketStatus = 'ISSUED' | 'SENT' | 'REDEEMED' | 'CANCELLED';

export type User =
  | { id: string; email: string; name: string; role: 'ORGANIZER' }
  | { id: string; email: string; name: string; role: 'SCANNER'; eventId: string; gate: string };

export interface EventSummary {
  id: string;
  name: string;
  venue: string;
  doorsOpenAt: string;
  endsAt: string;
  ticketCounts?: Record<TicketStatus, number>;
}

export interface Ticket {
  id: string;
  code: string;
  eventId: string;
  holderName: string;
  holderEmail: string;
  status: TicketStatus;
  redemption?: { at: string; gate: string };
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  action: 'ISSUE' | 'SEND' | 'REDEEM' | 'CANCEL';
  actorRole: Role | 'SYSTEM';
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  gate?: string;
  reason?: string;
  at: string;
}

export interface Admission {
  admitted: true;
  ticketId: string;
  holderName: string;
  eventName: string;
  gate: string | null;
  redeemedAt: string | null;
}
