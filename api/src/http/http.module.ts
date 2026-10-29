import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { ApplicationModule } from '../application/application.module.js';
import { apiEnv } from '../config/env.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AUTH_CONFIG, TokenService, type AuthConfig } from './auth/token.service.js';
import {
  AuthController,
  EventsController,
  HealthController,
  ScansController,
  TicketsController,
} from './controllers.js';
import { DomainErrorFilter } from './domain-error.filter.js';

@Module({
  imports: [ApplicationModule],
  controllers: [AuthController, EventsController, HealthController, ScansController, TicketsController],
  providers: [
    TokenService,
    {
      provide: AUTH_CONFIG,
      useFactory: (): AuthConfig => {
        const env = apiEnv();
        return { secret: env.JWT_SECRET, ttlMinutes: env.JWT_TTL_MINUTES };
      },
    },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class HttpModule {}
