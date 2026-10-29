/**
 * Module roots and app configuration for the three entrypoints: the HTTP API, the dispatcher
 * worker, and the seed script. Kept apart from the entrypoints themselves so the integration
 * tests build exactly the app that `main.ts` serves.
 */

import { Module, type INestApplication, type LoggerService } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import helmet from 'helmet';

import { DispatchModule } from './application/dispatch.module.js';
import { apiEnv, workerEnv } from './config/env.js';
import { HttpModule } from './http/http.module.js';
import { PersistenceModule } from './infrastructure/persistence/persistence.module.js';
import { logger } from './lib/logger.js';

/** Fail fast on a bad address rather than hanging for the 30 s default while looking healthy. */
const MONGO_OPTIONS = { serverSelectionTimeoutMS: 5_000 };

@Module({
  imports: [
    MongooseModule.forRootAsync({ useFactory: () => ({ uri: apiEnv().MONGODB_URI, ...MONGO_OPTIONS }) }),
    HttpModule,
  ],
})
export class ApiModule {}

@Module({
  imports: [
    MongooseModule.forRootAsync({ useFactory: () => ({ uri: workerEnv().MONGODB_URI, ...MONGO_OPTIONS }) }),
    DispatchModule,
  ],
})
export class WorkerModule {}

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: process.env['MONGODB_URI'] ?? '', ...MONGO_OPTIONS }),
    }),
    PersistenceModule,
  ],
})
export class SeedModule {}

/** Everything about the HTTP app that is not a module: prefix, headers, CORS. */
export function configureHttpApp(app: INestApplication, corsOrigin: string): void {
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({ origin: corsOrigin });
}

/** Routes Nest's own log lines through the JSON logger, so every line in a container is JSON. */
export const nestLogger: LoggerService = {
  log: (message: unknown, context?: unknown) => logger.info(String(message), { context }),
  warn: (message: unknown, context?: unknown) => logger.warn(String(message), { context }),
  error: (message: unknown, trace?: unknown, context?: unknown) =>
    logger.error(String(message), { trace, context }),
  debug: (message: unknown, context?: unknown) => logger.debug(String(message), { context }),
  verbose: (message: unknown, context?: unknown) => logger.debug(String(message), { context }),
};
