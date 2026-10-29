import nodemailer, { type Transporter } from 'nodemailer';
import QRCode from 'qrcode';

import { TicketMailer, type TicketEmail } from '../../application/ports.js';
import { formatTicketCode } from '../../domain/ticket-code.js';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly from: string;
}

/**
 * Every event in this slice is in one time zone. A real event carries its own, and the email
 * would format in that one — the holder cares when the doors open *there*, not in UTC.
 */
const EVENT_TIME_ZONE = 'Europe/Berlin';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: EVENT_TIME_ZONE,
});

/** Holder and event names are typed by people. In HTML they are text, never markup. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Delivers tickets over SMTP. In Docker Compose that is Mailpit, which accepts everything and
 * shows it at http://localhost:8025; in production it would be a provider's SMTP relay.
 */
export class SmtpTicketMailer extends TicketMailer {
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    super();
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // Mailpit speaks plain SMTP. A production relay would set secure / requireTLS here.
      secure: false,
    });
  }

  async send(email: TicketEmail): Promise<void> {
    const code = formatTicketCode(email.code);
    const doors = dateFormat.format(email.doorsOpenAt);
    // The QR code carries the canonical code; the printed text carries the readable one.
    // Both normalise to the same value at the gate.
    const qr = await QRCode.toBuffer(email.code, { errorCorrectionLevel: 'M', margin: 2, width: 280 });

    await this.transport.sendMail({
      from: this.config.from,
      to: email.to,
      subject: `Your ticket for ${email.eventName}`,
      // Stable per ticket, so that if at-least-once delivery sends a second copy, mail clients
      // can recognise it as the same message rather than a second ticket.
      messageId: `<ticket-${email.ticketId}@ticket-flow.example.test>`,
      text: [
        `Hello ${email.holderName},`,
        '',
        `Here is your ticket for ${email.eventName} at ${email.venue}.`,
        `Doors open: ${doors}`,
        '',
        `Ticket code: ${code}`,
        '',
        'Show the QR code or read out the ticket code at the entrance. It can be used once.',
      ].join('\n'),
      html: `
        <p>Hello ${escapeHtml(email.holderName)},</p>
        <p>Here is your ticket for <strong>${escapeHtml(email.eventName)}</strong>
           at ${escapeHtml(email.venue)}.<br>Doors open: ${escapeHtml(doors)}</p>
        <p><img src="cid:ticket-qr" alt="Ticket QR code" width="280" height="280"></p>
        <p style="font-family: monospace; font-size: 18px; letter-spacing: 2px">${code}</p>
        <p>Show the QR code or read out the ticket code at the entrance. It can be used once.</p>`,
      attachments: [{ filename: 'ticket.png', content: qr, cid: 'ticket-qr' }],
    });
  }
}
