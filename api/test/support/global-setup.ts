/**
 * One in-memory MongoDB *replica set* for the whole test run.
 *
 * A replica set, not a standalone server, because the code under test uses transactions and
 * standalone MongoDB has none — testing against a standalone would mean testing different
 * code. Each test file gets its own database on this server, so files never share state.
 */

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  project.provide('mongoUri', replSet.getUri());

  return async () => {
    await replSet.stop();
  };
}
