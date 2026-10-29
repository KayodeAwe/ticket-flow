/**
 * The single error type the domain layer throws.
 *
 * The domain does not know about HTTP, so it does not throw status codes or Nest's
 * `HttpException`. It throws a machine-readable `code`, and one exception filter decides
 * what each code means on the wire. The dispatcher drives the same domain code without HTTP
 * at all, which is the proof that the separation is real rather than decorative.
 */

export const DomainErrorCode = {
  /** No transition exists for this (status, action) pair. */
  InvalidTransition: 'INVALID_TRANSITION',
  /** The ticket has already been used. Carries when and at which gate. */
  AlreadyRedeemed: 'ALREADY_REDEEMED',
  /** The ticket was voided by the organizer. */
  TicketCancelled: 'TICKET_CANCELLED',
  /** The actor's role may never perform this action. */
  ForbiddenRole: 'FORBIDDEN_ROLE',
  /** Only the organizer who owns the event may do this. */
  NotEventOrganizer: 'NOT_EVENT_ORGANIZER',
  /** The ticket is for a different event than the one this scanner is admitting to. */
  WrongEvent: 'WRONG_EVENT',
  /** Doors are not open yet, or the event is over. */
  OutsideEntryWindow: 'OUTSIDE_ENTRY_WINDOW',
  /** Referenced entity does not exist, or the caller may not know that it does. */
  NotFound: 'NOT_FOUND',
  /** Someone else changed this ticket between our read and our write. */
  Conflict: 'CONFLICT',
} as const;

export type DomainErrorCode = (typeof DomainErrorCode)[keyof typeof DomainErrorCode];

/** Extra facts a client can render, such as when and where a ticket was already used. */
export type DomainErrorDetails = Readonly<Record<string, string>>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: DomainErrorDetails | undefined;

  constructor(code: DomainErrorCode, message: string, details?: DomainErrorDetails) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
