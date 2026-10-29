import { Module, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AuditRepository } from './audit.repository.js';
import { DatabaseHealth } from './database-health.js';
import { EventRepository } from './event.repository.js';
import { OutboxRepository } from './outbox.repository.js';
import {
  AUDIT_EVENT_MODEL,
  AuditEventSchema,
  EVENT_MODEL,
  EventSchema,
  OUTBOX_MODEL,
  OutboxMessageSchema,
  TICKET_MODEL,
  TicketSchema,
  USER_MODEL,
  UserSchema,
} from './schemas.js';
import { TicketRepository } from './ticket.repository.js';
import { UnitOfWork } from './unit-of-work.js';
import { UserRepository } from './user.repository.js';

const REPOSITORIES = [
  AuditRepository,
  DatabaseHealth,
  EventRepository,
  OutboxRepository,
  TicketRepository,
  UserRepository,
  UnitOfWork,
];

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AUDIT_EVENT_MODEL, schema: AuditEventSchema },
      { name: EVENT_MODEL, schema: EventSchema },
      { name: OUTBOX_MODEL, schema: OutboxMessageSchema },
      { name: TICKET_MODEL, schema: TicketSchema },
      { name: USER_MODEL, schema: UserSchema },
    ]),
  ],
  providers: REPOSITORIES,
  exports: REPOSITORIES,
})
export class PersistenceModule implements OnModuleInit {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Create every collection and build every index before the first request or claim.
   *
   * Mongoose does this in the background on its own, but the first write into a collection
   * that does not exist yet can land *inside a transaction* — issuing the first ticket writes
   * three collections at once — and racing an index build there fails with a catalog-change
   * error that has nothing to do with the request. Waiting here turns that into ordinary
   * startup work, and it is also when the unique index on ticket codes comes into force.
   */
  async onModuleInit(): Promise<void> {
    await Promise.all(Object.values(this.connection.models).map((model) => model.init()));
  }
}
