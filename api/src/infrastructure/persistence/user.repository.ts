import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';

import { Role } from '../../domain/types.js';
import { USER_MODEL, type LoginRole, type UserDoc } from './schemas.js';

export type { LoginRole } from './schemas.js';

/** A person who signs in. Scanners always carry their assignment; organizers never do. */
export type UserRecord =
  | { id: string; email: string; name: string; role: typeof Role.Organizer }
  | {
      id: string;
      email: string;
      name: string;
      role: typeof Role.Scanner;
      eventId: string;
      gate: string;
    };

/** Only ever produced by `findByEmailWithHash`, and never returned from a controller. */
export type UserWithHash = UserRecord & { passwordHash: string };

function toRecord(doc: UserDoc): UserRecord {
  const base = { id: doc._id.toString(), email: doc.email, name: doc.name };

  if (doc.role === Role.Scanner) {
    if (!doc.eventId || !doc.gate) {
      // The schema refuses to store this, so reaching here means the data was written around
      // it. Failing loudly beats a scanner who silently cannot admit anyone.
      throw new Error(`Scanner ${base.email} has no event or gate assigned.`);
    }
    return { ...base, role: Role.Scanner, eventId: doc.eventId.toString(), gate: doc.gate };
  }

  return { ...base, role: Role.Organizer };
}

@Injectable()
export class UserRepository {
  constructor(@InjectModel(USER_MODEL) private readonly users: Model<UserDoc>) {}

  async findById(id: string): Promise<UserRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.users.findById(id).exec();
    return doc ? toRecord(doc) : null;
  }

  /**
   * Login path only. `passwordHash` is `select: false` on the schema, so it has to be asked
   * for explicitly — which keeps the hash out of every other query by default rather than by
   * remembering to strip it.
   */
  async findByEmailWithHash(email: string): Promise<UserWithHash | null> {
    const doc = await this.users
      .findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash')
      .exec();
    return doc ? { ...toRecord(doc), passwordHash: doc.passwordHash } : null;
  }

  /** Seed only: create or replace a demo account by email. */
  async upsert(input: {
    email: string;
    name: string;
    role: LoginRole;
    passwordHash: string;
    eventId?: string;
    gate?: string;
  }): Promise<UserRecord> {
    const doc = await this.users
      .findOneAndUpdate(
        { email: input.email },
        {
          $set: {
            ...input,
            ...(input.eventId === undefined ? {} : { eventId: new Types.ObjectId(input.eventId) }),
          },
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .exec();
    return toRecord(doc);
  }
}
