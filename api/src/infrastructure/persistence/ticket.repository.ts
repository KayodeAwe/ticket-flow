import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import type { Redemption, TicketStatus } from '../../domain/types.js';
import { TICKET_MODEL, type TicketDoc } from './schemas.js';
import type { Tx } from './unit-of-work.js';

/** A ticket as the rest of the application sees it: plain data, string ids. */
export interface TicketRecord {
  id: string;
  code: string;
  eventId: string;
  holderName: string;
  holderEmail: string;
  status: TicketStatus;
  redemption?: Redemption;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTicketInput {
  code: string;
  eventId: string;
  holderName: string;
  holderEmail: string;
  status: TicketStatus;
}

function toRecord(doc: TicketDoc): TicketRecord {
  return {
    id: doc._id.toString(),
    code: doc.code,
    eventId: doc.eventId.toString(),
    holderName: doc.holderName,
    holderEmail: doc.holderEmail,
    status: doc.status,
    // Spread rather than assign: `exactOptionalPropertyTypes` distinguishes "absent" from
    // "present and undefined", and a ticket that was never used has no redemption at all.
    ...(doc.redeemedAt && doc.redeemedGate
      ? { redemption: { at: doc.redeemedAt, gate: doc.redeemedGate } }
      : {}),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class TicketRepository {
  constructor(@InjectModel(TICKET_MODEL) private readonly tickets: Model<TicketDoc>) {}

  async create(input: CreateTicketInput, tx: Tx): Promise<TicketRecord> {
    const [doc] = await this.tickets.create(
      [{ ...input, eventId: new Types.ObjectId(input.eventId) }],
      { session: tx },
    );
    if (!doc) throw new Error('Ticket.create returned no document.');
    return toRecord(doc);
  }

  async findById(id: string, tx?: Tx): Promise<TicketRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.tickets
      .findById(id)
      .session(tx ?? null)
      .exec();
    return doc ? toRecord(doc) : null;
  }

  async findByCode(code: string, tx?: Tx): Promise<TicketRecord | null> {
    const doc = await this.tickets
      .findOne({ code })
      .session(tx ?? null)
      .exec();
    return doc ? toRecord(doc) : null;
  }

  async listByEvent(eventId: string): Promise<TicketRecord[]> {
    if (!Types.ObjectId.isValid(eventId)) return [];
    const docs = await this.tickets
      .find({ eventId: new Types.ObjectId(eventId) })
      .sort({ createdAt: -1 })
      .exec();
    return docs.map(toRecord);
  }

  /** Ticket counts per status for each event, for an organizer's overview. */
  async countByStatus(eventIds: readonly string[]): Promise<Map<string, Map<TicketStatus, number>>> {
    const rows = await this.tickets
      .aggregate<{ _id: { eventId: Types.ObjectId; status: TicketStatus }; count: number }>([
        { $match: { eventId: { $in: eventIds.map((id) => new Types.ObjectId(id)) } } },
        { $group: { _id: { eventId: '$eventId', status: '$status' }, count: { $sum: 1 } } },
      ])
      .exec();

    const result = new Map<string, Map<TicketStatus, number>>();
    for (const row of rows) {
      const key = row._id.eventId.toString();
      const counts = result.get(key) ?? new Map<TicketStatus, number>();
      counts.set(row._id.status, row.count);
      result.set(key, counts);
    }
    return result;
  }

  /**
   * Move a ticket from one status to another, conditional on it still being in `fromStatus`.
   *
   * The status is part of the filter, not just the update. Two scanners reading the same
   * ticket in the same second both decide "admit"; written unconditionally, both writes land
   * and two people walk in on one ticket. With the status in the filter, the second write
   * matches nothing and returns null, and the caller refuses the scan.
   *
   * Inside a transaction there is a second line of defence: the losing transaction hits a
   * write conflict and the driver retries it from the read, at which point the state machine
   * sees REDEEMED and refuses with ALREADY_REDEEMED. The filter is what makes this correct
   * even for a caller that forgets the transaction.
   */
  async applyTransition(
    id: string,
    fromStatus: TicketStatus,
    toStatus: TicketStatus,
    tx: Tx,
    redemption?: Redemption,
  ): Promise<TicketRecord | null> {
    const doc = await this.tickets
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), status: fromStatus },
        {
          $set: {
            status: toStatus,
            ...(redemption ? { redeemedAt: redemption.at, redeemedGate: redemption.gate } : {}),
          },
        },
        { returnDocument: 'after', session: tx },
      )
      .exec();

    return doc ? toRecord(doc) : null;
  }
}
