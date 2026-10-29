import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { nestLogger, WorkerModule } from './app.js';
import { DispatchService } from './application/dispatch.service.js';
import { workerEnv } from './config/env.js';
import { logger, setLogLevel } from './lib/logger.js';

/**
 * The dispatcher: no HTTP server, one loop. It can run as any number of replicas —
 * `docker compose up --scale dispatcher=3` — because each outbox claim is atomic.
 */
async function main(): Promise<void> {
  const env = workerEnv();
  setLogLevel(env.LOG_LEVEL);

  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: nestLogger });

  // Stop claiming new work on SIGTERM, finish the message in hand, then close. A message
  // interrupted mid-delivery is not lost either way: its lease expires and it is claimed again.
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());

  await app.get(DispatchService).run(stop.signal);
  await app.close();
}

main().catch((error: unknown) => {
  logger.error('Dispatcher failed', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
