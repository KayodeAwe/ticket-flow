/**
 * Controllers do three things: parse input, call one application service, shape the response.
 *
 * There is no business logic here and nothing from `infrastructure/` — `CLAUDE.md` forbids
 * both, and `.claude/hooks/check-layering.mjs` fails the write if either appears. No controller
 * reads `.status` to decide anything; that belongs to the state machine alone.
 */

import { Body, Controller, Get, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';

import { AuthService } from '../application/auth.service.js';
import { EventsService } from '../application/events.service.js';
import { HealthService } from '../application/health.service.js';
import { ScansService } from '../application/scans.service.js';
import { TicketsService } from '../application/tickets.service.js';
import { Role, type Actor } from '../domain/types.js';
import { CurrentUser, Public, Roles } from './auth/decorators.js';
import { TokenService, type AuthenticatedUser } from './auth/token.service.js';
import {
  CancelTicketSchema,
  IdParamSchema,
  IssueTicketSchema,
  LoginSchema,
  ScanSchema,
} from './schemas.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  check() {
    return this.health.check();
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const { email, password } = LoginSchema.parse(body);

    const user = await this.auth.login(email, password);
    if (!user) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      });
    }

    const actor: Actor =
      user.role === Role.Scanner
        ? { role: Role.Scanner, id: user.id, eventId: user.eventId, gate: user.gate }
        : { role: Role.Organizer, id: user.id };

    return {
      token: this.tokens.sign({ actor, email: user.email, name: user.name }),
      user,
    };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user: { ...user.actor, email: user.email, name: user.name } };
  }
}

@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly tickets: TicketsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { events: await this.events.listForActor(user.actor) };
  }

  @Roles(Role.Organizer)
  @Get(':id/tickets')
  async listTickets(@Param() params: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { id } = IdParamSchema.parse(params);
    return { tickets: await this.tickets.listForEvent(id, user.actor) };
  }

  @Roles(Role.Organizer)
  @Post(':id/tickets')
  async issue(@Param() params: unknown, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { id } = IdParamSchema.parse(params);
    const input = IssueTicketSchema.parse(body);
    return { ticket: await this.tickets.issue({ actor: user.actor, eventId: id, ...input }) };
  }
}

@Roles(Role.Organizer)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get(':id')
  async get(@Param() params: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { id } = IdParamSchema.parse(params);
    return this.tickets.get(id, user.actor);
  }

  @Get(':id/audit')
  async audit(@Param() params: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { id } = IdParamSchema.parse(params);
    return { events: await this.tickets.auditTrail(id, user.actor) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param() params: unknown, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { id } = IdParamSchema.parse(params);
    const { reason } = CancelTicketSchema.parse(body ?? {});
    return {
      ticket: await this.tickets.cancel({
        actor: user.actor,
        ticketId: id,
        ...(reason === undefined ? {} : { reason }),
      }),
    };
  }
}

@Roles(Role.Scanner)
@Controller('scans')
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  /**
   * 200 with `admitted: true`, or a 409 whose error code says why not. Only what the person at
   * the gate needs comes back — not the holder's email, not the code.
   */
  @Post()
  @HttpCode(200)
  async scan(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const { code } = ScanSchema.parse(body);
    const { ticket, event } = await this.scans.redeem(code, user.actor);

    return {
      admitted: true,
      ticketId: ticket.id,
      holderName: ticket.holderName,
      eventName: event.name,
      gate: ticket.redemption?.gate ?? null,
      redeemedAt: ticket.redemption?.at ?? null,
    };
  }
}
