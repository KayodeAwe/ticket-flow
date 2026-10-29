import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { EVENT_MODEL, type EventDoc } from './schemas.js';
import type { Tx } from './unit-of-work.js';

export interface EventRecord {
  id: string;
  name: string;
  venue: string;
  doorsOpenAt: Date;
  endsAt: Date;
  organizerId: string;
}

function toRecord(doc: EventDoc): EventRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    venue: doc.venue,
    doorsOpenAt: doc.doorsOpenAt,
    endsAt: doc.endsAt,
    organizerId: doc.organizerId.toString(),
  };
}

@Injectable()
export class EventRepository {
  constructor(@InjectModel(EVENT_MODEL) private readonly events: Model<EventDoc>) {}

  async findById(id: string, tx?: Tx): Promise<EventRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.events
      .findById(id)
      .session(tx ?? null)
      .exec();
    return doc ? toRecord(doc) : null;
  }

  /** Seed only: create or replace a demo event by name. */
  async upsertByName(input: Omit<EventRecord, 'id'>): Promise<EventRecord> {
    const doc = await this.events
      .findOneAndUpdate(
        { name: input.name },
        { $set: { ...input, organizerId: new Types.ObjectId(input.organizerId) } },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .exec();
    return toRecord(doc);
  }

  async listByOrganizer(organizerId: string): Promise<EventRecord[]> {
    if (!Types.ObjectId.isValid(organizerId)) return [];
    const docs = await this.events
      .find({ organizerId: new Types.ObjectId(organizerId) })
      .sort({ doorsOpenAt: 1 })
      .exec();
    return docs.map(toRecord);
  }
}
