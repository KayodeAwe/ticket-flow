/**
 * Every Mongoose schema in the application, in one file.
 *
 * Plain `Schema` definitions rather than Nest's `@Schema`/`@Prop` classes: the decorator form
 * duplicates every field between a TypeScript class and its metadata, and the duplicate that
 * drifts is always the one nobody reads. Here the interface is the type and the schema is the
 * validation, side by side.
 *
 * This file — and the repositories beside it — are the only places Mongoose is touched.
 * `CLAUDE.md` forbids `http/` and `application/` from importing it, and
 * `.claude/hooks/check-layering.mjs` enforces that on every write.
 */

import { Schema, type Types } from 'mongoose';

import { ALL_ACTIONS, ALL_STATUSES, Role, type TicketAction, type TicketStatus } from '../../domain/types.js';

// --- Event -------------------------------------------------------------------------------

export const EVENT_MODEL = 'Event';

export interface EventDoc {
  _id: Types.ObjectId;
  name: string;
  venue: string;
  doorsOpenAt: Date;
  endsAt: Date;
  organizerId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const EventSchema = new Schema<EventDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    venue: { type: String, required: true, trim: true, maxlength: 140 },
    doorsOpenAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    organizerId: { type: Schema.Types.ObjectId, required: true, index: true },
  },
  { timestamps: true },
);

EventSchema.pre('validate', function requireOpenWindow() {
  // An event that ends before its doors open has an empty entry window, and every scan would
  // be refused with a message that points nowhere near the cause. A document hook rather than
  // a field validator, because the rule compares two fields.
  if (this.endsAt.getTime() <= this.doorsOpenAt.getTime()) {
    throw new Error('endsAt must be after doorsOpenAt.');
  }
});

// --- Ticket ------------------------------------------------------------------------------

export const TICKET_MODEL = 'Ticket';

export interface TicketDoc {
  _id: Types.ObjectId;
  code: string;
  eventId: Types.ObjectId;
  holderName: string;
  holderEmail: string;
  status: TicketStatus;
  redeemedAt?: Date;
  redeemedGate?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const TicketSchema = new Schema<TicketDoc>(
  {
    // Unique, because the code is what the gate looks a ticket up by. Two tickets sharing a
    // code would mean redeeming one silently tells the holder of the other "already used".
    code: { type: String, required: true, unique: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    holderName: { type: String, required: true, trim: true, maxlength: 120 },
    holderEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // No default. The initial status is decided by the state machine like every other one.
    status: { type: String, required: true, enum: ALL_STATUSES },
    redeemedAt: { type: Date },
    redeemedGate: { type: String, trim: true, maxlength: 60 },
  },
  { timestamps: true },
);

// An organizer's ticket list for one event, newest first.
TicketSchema.index({ eventId: 1, createdAt: -1 });

// --- Audit event -------------------------------------------------------------------------

export const AUDIT_EVENT_MODEL = 'AuditEvent';

/** Issuing is recorded too, although it is not a transition: there is no status before it. */
export const AuditAction = { Issue: 'ISSUE' } as const;
export type AuditAction = typeof AuditAction.Issue | TicketAction;

export interface AuditEventDoc {
  _id: Types.ObjectId;
  ticketId: Types.ObjectId;
  /** A user id, or `system:dispatcher` for deliveries. */
  actorId: string;
  actorRole: Role;
  action: AuditAction;
  /** Null only for ISSUE. */
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  gate?: string;
  reason?: string;
  at: Date;
}

const AuditEventSchemaDefinition = new Schema<AuditEventDoc>(
  {
    ticketId: { type: Schema.Types.ObjectId, required: true },
    actorId: { type: String, required: true },
    actorRole: { type: String, required: true, enum: Object.values(Role) },
    action: { type: String, required: true, enum: [AuditAction.Issue, ...ALL_ACTIONS] },
    fromStatus: { type: String, enum: [...ALL_STATUSES, null], default: null },
    toStatus: { type: String, required: true, enum: ALL_STATUSES },
    gate: { type: String, trim: true, maxlength: 60 },
    reason: { type: String, trim: true, maxlength: 500 },
    at: { type: Date, required: true },
  },
  {
    // No `timestamps`: an audit row is written once and never touched, so an `updatedAt`
    // would be a field that can only ever lie.
    timestamps: false,
  },
);

// One ticket's trail, in order.
AuditEventSchemaDefinition.index({ ticketId: 1, at: 1 });

/**
 * Append-only, enforced at the model rather than by convention.
 *
 * The whole value of an audit trail is that it cannot be quietly rewritten, and a rule that
 * lives only in a document is one refactor away from being broken by someone who never read
 * it. These hooks make every update and delete path fail loudly instead.
 */
const MUTATING_QUERIES = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const;

for (const op of MUTATING_QUERIES) {
  AuditEventSchemaDefinition.pre(op, { document: false, query: true }, function reject() {
    throw new Error(
      `AuditEvent is append-only: "${op}" is not permitted. ` +
        'If a recorded event is wrong, append a correcting event rather than editing history.',
    );
  });
}

AuditEventSchemaDefinition.pre('save', function rejectResave() {
  if (!this.isNew) {
    throw new Error('AuditEvent is append-only: an existing event cannot be re-saved.');
  }
});

export const AuditEventSchema = AuditEventSchemaDefinition;

// --- Outbox message ----------------------------------------------------------------------

export const OUTBOX_MODEL = 'OutboxMessage';

export const OutboxType = { TicketIssued: 'TICKET_ISSUED' } as const;
export type OutboxType = (typeof OutboxType)[keyof typeof OutboxType];

/**
 * Where a message is in delivery. Called `state`, not `status`, so it can never be mistaken
 * for a ticket status — by a reader, or by the layering hook that guards ticket status writes.
 */
export const OutboxState = {
  Pending: 'PENDING',
  Processing: 'PROCESSING',
  Done: 'DONE',
  /** Nothing to deliver any more — the ticket was cancelled or used before its email went out. */
  Skipped: 'SKIPPED',
  /** Gave up after the maximum number of attempts. Needs a human. */
  Failed: 'FAILED',
} as const;
export type OutboxState = (typeof OutboxState)[keyof typeof OutboxState];

export interface OutboxMessageDoc {
  _id: Types.ObjectId;
  type: OutboxType;
  ticketId: Types.ObjectId;
  state: OutboxState;
  /** Incremented on every claim. Doubles as a fencing token — see OutboxRepository. */
  attempts: number;
  availableAt: Date;
  leaseUntil?: Date;
  lastError?: string;
  note?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const OutboxMessageSchema = new Schema<OutboxMessageDoc>(
  {
    type: { type: String, required: true, enum: Object.values(OutboxType) },
    ticketId: { type: Schema.Types.ObjectId, required: true },
    state: { type: String, required: true, enum: Object.values(OutboxState) },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    availableAt: { type: Date, required: true },
    leaseUntil: { type: Date },
    lastError: { type: String, maxlength: 2000 },
    note: { type: String, maxlength: 500 },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

// The dispatcher's claim query: oldest available work first.
OutboxMessageSchema.index({ state: 1, availableAt: 1 });

// --- User --------------------------------------------------------------------------------

export const USER_MODEL = 'User';

/** People who sign in. The dispatcher's SYSTEM role is deliberately not one of them. */
export const LOGIN_ROLES = [Role.Organizer, Role.Scanner] as const;
export type LoginRole = (typeof LOGIN_ROLES)[number];

export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: LoginRole;
  passwordHash: string;
  /** Scanners only. */
  eventId?: Types.ObjectId;
  /** Scanners only. */
  gate?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: LOGIN_ROLES },
    // `select: false` so a stray `findOne()` cannot leak the hash into a response body.
    passwordHash: { type: String, required: true, select: false },
    eventId: { type: Schema.Types.ObjectId },
    gate: { type: String, trim: true, maxlength: 60 },
  },
  { timestamps: true },
);

UserSchema.pre('validate', function requireScannerAssignment() {
  // A scanner with no event cannot admit anyone, and one with no gate leaves a redemption
  // that says nothing about where it happened. Refuse to store either.
  if (this.role === Role.Scanner && (!this.eventId || !this.gate)) {
    throw new Error('A scanner must be assigned an event and a gate.');
  }
});
