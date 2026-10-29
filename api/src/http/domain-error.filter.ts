import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';

import { DomainError, DomainErrorCode, type DomainErrorDetails } from '../domain/errors.js';
import { logger } from '../lib/logger.js';

/** Every error response in this API has this shape. Controllers never build one by hand. */
export interface ErrorBody {
  error: { code: string; message: string; details?: DomainErrorDetails };
}

/**
 * The single place domain error codes become HTTP status codes.
 *
 * Every refusal at the gate is a 409: the request was well formed, it just does not apply to
 * the ticket as it is now. A scanner app can treat 409 uniformly as "do not admit" and show the
 * code's reason, rather than learning a status code per reason.
 */
const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  [DomainErrorCode.NotFound]: HttpStatus.NOT_FOUND,
  [DomainErrorCode.ForbiddenRole]: HttpStatus.FORBIDDEN,
  [DomainErrorCode.NotEventOrganizer]: HttpStatus.FORBIDDEN,
  [DomainErrorCode.InvalidTransition]: HttpStatus.CONFLICT,
  [DomainErrorCode.AlreadyRedeemed]: HttpStatus.CONFLICT,
  [DomainErrorCode.TicketCancelled]: HttpStatus.CONFLICT,
  [DomainErrorCode.WrongEvent]: HttpStatus.CONFLICT,
  [DomainErrorCode.OutsideEntryWindow]: HttpStatus.CONFLICT,
  [DomainErrorCode.Conflict]: HttpStatus.CONFLICT,
};

/** Codes for errors Nest or Express raise themselves: unknown route, malformed JSON, and so on. */
const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
};

interface JsonResponse {
  status(code: number): { json(body: ErrorBody): void };
}

function hasCodeAndMessage(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  );
}

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const [status, body] = this.describe(exception);
    response.status(status).json(body);
  }

  private describe(exception: unknown): [number, ErrorBody] {
    if (exception instanceof ZodError) {
      const message = exception.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      return [HttpStatus.BAD_REQUEST, { error: { code: 'VALIDATION_FAILED', message } }];
    }

    if (exception instanceof DomainError) {
      return [
        STATUS_BY_CODE[exception.code],
        {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details ? { details: exception.details } : {}),
          },
        },
      ];
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (hasCodeAndMessage(raw)) return [status, { error: { code: raw.code, message: raw.message } }];
      return [status, { error: { code: CODE_BY_STATUS[status] ?? 'HTTP_ERROR', message: exception.message } }];
    }

    // Anything reaching here is unexpected. Log it in full for us; tell the client nothing. A
    // stack trace or a Mongoose validation object in a response body is an information leak,
    // and it is the default behaviour if this branch is forgotten.
    logger.error('Unhandled error', {
      message: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
    ];
  }
}
