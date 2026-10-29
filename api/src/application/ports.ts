/**
 * What the application layer needs from the outside world, stated as abstract classes.
 *
 * Abstract classes rather than interfaces because Nest injects by runtime token, and an
 * interface does not exist at runtime. The implementations live in `infrastructure/` and are
 * bound in the modules; tests bind fakes. The application layer never learns that the mailer
 * is SMTP or that the clock is the system clock.
 */

export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Everything a delivery email needs. Deliberately no ids beyond the ticket's own. */
export interface TicketEmail {
  readonly ticketId: string;
  readonly to: string;
  readonly holderName: string;
  readonly eventName: string;
  readonly venue: string;
  readonly doorsOpenAt: Date;
  /** The canonical code; the mailer formats it and renders the QR image. */
  readonly code: string;
}

export abstract class TicketMailer {
  /** Resolve when the message has been accepted for delivery; reject otherwise. */
  abstract send(email: TicketEmail): Promise<void>;
}
