/**
 * The only place the web app talks HTTP. Components never call `fetch`; they call the hooks in
 * `queries.ts`, which call this.
 *
 * Every failure becomes an `ApiError` carrying the server's machine-readable code, so a page
 * can tell ALREADY_REDEEMED from WRONG_EVENT without parsing a message meant for people.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => undefined;

export function setToken(value: string | null): void {
  token = value;
}

/** Called when the server rejects the token — it expired, or the secret was rotated. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toApiError(status: number, body: unknown): ApiError {
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
  const code = typeof error?.['code'] === 'string' ? error['code'] : 'HTTP_ERROR';
  const message = typeof error?.['message'] === 'string' ? error['message'] : `Request failed (${status}).`;

  const details: Record<string, string> = {};
  if (error && isRecord(error['details'])) {
    for (const [key, value] of Object.entries(error['details'])) {
      if (typeof value === 'string') details[key] = value;
    }
  }
  return new ApiError(status, code, message, details);
}

export async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check the connection.');
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A proxy error page, not our API. Fall through with no body.
  }

  if (!response.ok) {
    const error = toApiError(response.status, data);
    if (response.status === 401 && token) onUnauthorized();
    throw error;
  }

  // The API is the contract for this shape, and its integration tests pin it. Validating every
  // response again here would mean a second copy of every schema to keep in step.
  return data as T;
}
