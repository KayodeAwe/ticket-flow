import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

@Injectable()
export class DatabaseHealth {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** A round trip to the server, not just a look at the driver's cached connection state. */
  async ping(): Promise<void> {
    const db = this.connection.db;
    if (!db) throw new Error('MongoDB connection is not open.');
    await db.admin().ping();
  }
}
