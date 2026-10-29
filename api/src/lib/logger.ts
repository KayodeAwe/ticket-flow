/**
 * A structured logger in one file, with no dependency.
 *
 * It writes one JSON object per line to stdout, which is what a container log collector
 * wants and what makes fields queryable rather than regex-scraped. That is the entire
 * requirement for a service this size, so a logging library would be a dependency bought
 * for nothing — `CLAUDE.md` asks for a reason before adding one.
 *
 * `console.log` is not error handling: use these, so that output carries a level and a
 * timestamp and can be filtered.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LEVELS;

let threshold: number = LEVELS.info;

export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS[level];
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;

  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...context,
  });

  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
