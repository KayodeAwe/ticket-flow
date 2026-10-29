import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';

/**
 * An opaque handle for "the transaction this work belongs to".
 *
 * Application services pass a `Tx` from `UnitOfWork.run` into repository calls without ever
 * naming Mongoose. That is what lets `CLAUDE.md`'s layering rule hold while the application
 * layer still owns transaction boundaries, which is where they belong: only the use case
 * knows which writes must succeed together.
 */
export type Tx = ClientSession;

@Injectable()
export class UnitOfWork {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Run `fn` in a MongoDB transaction: commit on success, abort on any throw.
   *
   * The driver retries `fn` on transient transaction errors — including a write conflict
   * with a concurrent transaction, which is exactly what the losing scan of a double scan
   * hits. So `fn` must be safe to run more than once: database writes only, through `tx`.
   * Never send an email or call another service from inside it.
   *
   * Transactions need a replica set; standalone MongoDB has none. See docker-compose.yml.
   */
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.connection.transaction(fn);
  }
}
