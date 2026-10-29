import { Module } from '@nestjs/common';

import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { EventsService } from './events.service.js';
import { Clock, SystemClock } from './ports.js';
import { ScansService } from './scans.service.js';
import { TicketsService } from './tickets.service.js';

/** The use cases behind the HTTP API. Sends no email: that is the dispatcher's job alone. */
@Module({
  imports: [PersistenceModule],
  providers: [EventsService, ScansService, TicketsService, { provide: Clock, useClass: SystemClock }],
  exports: [EventsService, ScansService, TicketsService],
})
export class ApplicationModule {}
