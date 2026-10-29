import { Module } from '@nestjs/common';

import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { AuthService } from './auth.service.js';
import { EventsService } from './events.service.js';
import { HealthService } from './health.service.js';
import { Clock, SystemClock } from './ports.js';
import { ScansService } from './scans.service.js';
import { TicketsService } from './tickets.service.js';

const SERVICES = [AuthService, EventsService, HealthService, ScansService, TicketsService];

/** The use cases behind the HTTP API. Sends no email: that is the dispatcher's job alone. */
@Module({
  imports: [PersistenceModule],
  providers: [...SERVICES, { provide: Clock, useClass: SystemClock }],
  exports: SERVICES,
})
export class ApplicationModule {}
