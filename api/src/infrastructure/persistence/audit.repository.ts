import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import type { Role, TicketStatus } from '../../domain/types.js';
import { AUDIT_EVENT_MODEL, type AuditAction, type AuditEventDoc } from './schemas.js';
import type { Tx } from './unit-of-work.js';

export { AuditAction } from './schemas.js';

export interface AuditEventRecord {
  id: string;
  ticketId: string;
  actorId: string;
  actorRole: Role;
  action: AuditAction;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  gate?: string;
  reason?: string;
  at: Date;
}

export interface AppendInput {
  ticketId: string;
  actorId: string;
  actorRole: Role;
  action: AuditAction;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  gate?: string;
  reason?: string;
  at: Date;
}

function toRecord(doc: AuditEventDoc): AuditEventRecord {
  return {
    id: doc._id.toString(),
    ticketId: doc.ticketId.toString(),
    actorId: doc.actorId,
    actorRole: doc.actorRole,
    action: doc.action,
    fromStatus: doc.fromStatus,
    toStatus: doc.toStatus,
    ...(doc.gate === undefined ? {} : { gate: doc.gate }),
    ...(doc.reason === undefined ? {} : { reason: doc.reason }),
    at: doc.at,
  };
}

@Injectable()
export class AuditRepository {
  constructor(@InjectModel(AUDIT_EVENT_MODEL) private readonly events: Model<AuditEventDoc>) {}

  /**
   * Append one immutable event.
   *
   * `tx` is required, not optional. An audit append that is not part of the same transaction
   * as the change it records is the exact bug this design exists to prevent, and an optional
   * parameter would let a caller introduce it without noticing.
   */
  async append(input: AppendInput, tx: Tx): Promise<AuditEventRecord> {
    const [doc] = await this.events.create(
      [{ ...input, ticketId: new Types.ObjectId(input.ticketId) }],
      { session: tx },
    );
    if (!doc) throw new Error('AuditEvent.create returned no document.');
    return toRecord(doc);
  }

  async listForTicket(ticketId: string): Promise<AuditEventRecord[]> {
    if (!Types.ObjectId.isValid(ticketId)) return [];
    const docs = await this.events
      .find({ ticketId: new Types.ObjectId(ticketId) })
      .sort({ at: 1, _id: 1 })
      .exec();
    return docs.map(toRecord);
  }
}
