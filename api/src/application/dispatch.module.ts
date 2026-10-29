import { Module } from '@nestjs/common';

import { MailModule } from '../infrastructure/mail/mail.module.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { DispatchService } from './dispatch.service.js';
import { Clock, SystemClock } from './ports.js';

/** The dispatcher's use case and the one thing it alone needs: a way to send email. */
@Module({
  imports: [PersistenceModule, MailModule],
  providers: [DispatchService, { provide: Clock, useClass: SystemClock }],
  exports: [DispatchService],
})
export class DispatchModule {}
