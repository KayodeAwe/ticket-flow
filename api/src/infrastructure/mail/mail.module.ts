import { Module } from '@nestjs/common';

import { TicketMailer } from '../../application/ports.js';
import { workerEnv } from '../../config/env.js';
import { SmtpTicketMailer } from './smtp-ticket-mailer.js';

@Module({
  providers: [
    {
      provide: TicketMailer,
      useFactory: (): TicketMailer => {
        const env = workerEnv();
        return new SmtpTicketMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, from: env.MAIL_FROM });
      },
    },
  ],
  exports: [TicketMailer],
})
export class MailModule {}
