import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { ApiModule, configureHttpApp, nestLogger } from './app.js';
import { apiEnv } from './config/env.js';
import { logger, setLogLevel } from './lib/logger.js';

async function main(): Promise<void> {
  // Reading configuration first means an invalid environment stops the process here, with a
  // message naming the variable, before a port is bound or a connection is opened.
  const env = apiEnv();
  setLogLevel(env.LOG_LEVEL);

  const app = await NestFactory.create(ApiModule, { logger: nestLogger });
  configureHttpApp(app, env.CORS_ORIGIN);

  // Kubernetes and `docker compose down` both send SIGTERM and then wait. Shutdown hooks let
  // in-flight requests finish and close the database connection instead of cutting both off.
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  logger.info('API listening', { port: env.PORT, env: env.NODE_ENV });
}

main().catch((error: unknown) => {
  logger.error('API failed to start', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
