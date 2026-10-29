/**
 * Environment configuration, validated once at startup.
 *
 * Each entrypoint validates only what it uses: the API needs a JWT secret and no SMTP server,
 * the dispatcher the reverse. A process refuses to start on invalid configuration rather than
 * failing later at the first request that happens to need the missing value. `JWT_SECRET` has
 * no default anywhere in this codebase: a development fallback secret is precisely how a
 * development secret reaches production.
 */

import { z } from 'zod';

const BaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required and must point at a replica set (transactions).'),
});

const ApiEnvSchema = BaseSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_SECRET: z
    .string()
    .min(
      32,
      'JWT_SECRET must be at least 32 characters. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    ),
  JWT_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const WorkerEnvSchema = BaseSchema.extend({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  MAIL_FROM: z.email(),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

function parse<T>(schema: z.ZodType<T>, source: NodeJS.ProcessEnv): T {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

let api: ApiEnv | undefined;
let worker: WorkerEnv | undefined;

/** Validated once, reused thereafter. Throws on first call if the environment is wrong. */
export function apiEnv(): ApiEnv {
  api ??= parse(ApiEnvSchema, process.env);
  return api;
}

export function workerEnv(): WorkerEnv {
  worker ??= parse(WorkerEnvSchema, process.env);
  return worker;
}

/** For tests of the validation itself; the application always goes through the cached form. */
export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  return parse(ApiEnvSchema, source);
}
