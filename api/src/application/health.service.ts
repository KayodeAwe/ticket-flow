import { Injectable } from '@nestjs/common';

import { DatabaseHealth } from '../infrastructure/persistence/database-health.js';
import { OutboxRepository, type OutboxStats } from '../infrastructure/persistence/outbox.repository.js';
import { Clock } from './ports.js';

export interface HealthReport {
  readonly status: 'ok';
  /**
   * Delivery backlog. The dispatcher has no HTTP port of its own, so this is how it is
   * watched: `oldestPendingSeconds` climbing while `pending` stays above zero means tickets
   * are being issued and nobody is sending them. That is the number to alert on.
   */
  readonly outbox: OutboxStats;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseHealth,
    private readonly outbox: OutboxRepository,
    private readonly clock: Clock,
  ) {}

  /** Throws when the database is unreachable, so the endpoint answers 500 and the probe fails. */
  async check(): Promise<HealthReport> {
    await this.database.ping();
    return { status: 'ok', outbox: await this.outbox.stats(this.clock.now()) };
  }
}
