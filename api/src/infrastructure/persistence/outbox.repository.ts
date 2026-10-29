import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import {
  OUTBOX_MODEL,
  OutboxState,
  type OutboxMessageDoc,
  type OutboxType,
} from './schemas.js';
import type { Tx } from './unit-of-work.js';

export { OutboxState, OutboxType } from './schemas.js';

export interface OutboxMessageRecord {
  id: string;
  type: OutboxType;
  ticketId: string;
  state: OutboxState;
  attempts: number;
  availableAt: Date;
  lastError?: string;
  note?: string;
}

export interface OutboxStats {
  pending: number;
  failed: number;
  /** Age of the oldest message still waiting, or null when nothing is waiting. */
  oldestPendingSeconds: number | null;
}

function toRecord(doc: OutboxMessageDoc): OutboxMessageRecord {
  return {
    id: doc._id.toString(),
    type: doc.type,
    ticketId: doc.ticketId.toString(),
    state: doc.state,
    attempts: doc.attempts,
    availableAt: doc.availableAt,
    ...(doc.lastError === undefined ? {} : { lastError: doc.lastError }),
    ...(doc.note === undefined ? {} : { note: doc.note }),
  };
}

/**
 * The transactional outbox: delivery work recorded in the same transaction as the change
 * that caused it, and handed to the dispatcher afterwards.
 *
 * Writing straight to a queue from the request would leave a gap either way: queue first and
 * a rolled-back ticket gets an email; ticket first and a crash before the publish leaves a
 * ticket that is never delivered. Writing the message into the same database transaction as
 * the ticket closes it. In production the dispatcher would forward to SQS or a mail provider;
 * the guarantee comes from this collection, not from the transport.
 */
@Injectable()
export class OutboxRepository {
  constructor(@InjectModel(OUTBOX_MODEL) private readonly messages: Model<OutboxMessageDoc>) {}

  async enqueue(input: { type: OutboxType; ticketId: string; at: Date }, tx: Tx): Promise<void> {
    await this.messages.create(
      [
        {
          type: input.type,
          ticketId: new Types.ObjectId(input.ticketId),
          state: OutboxState.Pending,
          attempts: 0,
          availableAt: input.at,
        },
      ],
      { session: tx },
    );
  }

  /**
   * Atomically take the oldest available message, or a message whose previous claimant's
   * lease has expired (it crashed, or hung).
   *
   * One `findOneAndUpdate` is the whole claim, so any number of dispatcher replicas can run
   * this concurrently and each message goes to exactly one of them at a time.
   */
  async claimNext(now: Date, leaseMs: number): Promise<OutboxMessageRecord | null> {
    const doc = await this.messages
      .findOneAndUpdate(
        {
          $or: [
            { state: OutboxState.Pending, availableAt: { $lte: now } },
            { state: OutboxState.Processing, leaseUntil: { $lte: now } },
          ],
        },
        {
          $set: { state: OutboxState.Processing, leaseUntil: new Date(now.getTime() + leaseMs) },
          $inc: { attempts: 1 },
        },
        { sort: { availableAt: 1 }, returnDocument: 'after' },
      )
      .exec();

    return doc ? toRecord(doc) : null;
  }

  /**
   * Finish a claimed message.
   *
   * Conditional on `attempts` as well as the id: `attempts` is incremented on every claim, so
   * it works as a fencing token. A dispatcher that stalled past its lease, while another
   * replica re-claimed the message, cannot then overwrite that replica's outcome. Returns false
   * when the claim was lost.
   */
  async complete(
    message: OutboxMessageRecord,
    state: typeof OutboxState.Done | typeof OutboxState.Skipped,
    now: Date,
    note?: string,
  ): Promise<boolean> {
    return this.settle(message, {
      state,
      completedAt: now,
      ...(note === undefined ? {} : { note }),
    });
  }

  async retryLater(message: OutboxMessageRecord, error: string, availableAt: Date): Promise<boolean> {
    return this.settle(message, { state: OutboxState.Pending, availableAt, lastError: error });
  }

  async fail(message: OutboxMessageRecord, error: string, now: Date): Promise<boolean> {
    return this.settle(message, { state: OutboxState.Failed, lastError: error, completedAt: now });
  }

  async stats(now: Date): Promise<OutboxStats> {
    const [pending, failed, oldest] = await Promise.all([
      this.messages.countDocuments({
        state: { $in: [OutboxState.Pending, OutboxState.Processing] },
      }),
      this.messages.countDocuments({ state: OutboxState.Failed }),
      this.messages
        .findOne({ state: { $in: [OutboxState.Pending, OutboxState.Processing] } })
        .sort({ createdAt: 1 })
        .exec(),
    ]);

    return {
      pending,
      failed,
      oldestPendingSeconds: oldest
        ? Math.max(0, Math.round((now.getTime() - oldest.createdAt.getTime()) / 1000))
        : null,
    };
  }

  async findForTicket(ticketId: string): Promise<OutboxMessageRecord[]> {
    if (!Types.ObjectId.isValid(ticketId)) return [];
    const docs = await this.messages.find({ ticketId: new Types.ObjectId(ticketId) }).exec();
    return docs.map(toRecord);
  }

  private async settle(
    message: OutboxMessageRecord,
    set: Partial<Pick<OutboxMessageDoc, 'state' | 'availableAt' | 'lastError' | 'note' | 'completedAt'>>,
  ): Promise<boolean> {
    const result = await this.messages
      .updateOne(
        {
          _id: new Types.ObjectId(message.id),
          state: OutboxState.Processing,
          attempts: message.attempts,
        },
        { $set: set, $unset: { leaseUntil: 1 } },
      )
      .exec();
    return result.modifiedCount === 1;
  }
}
