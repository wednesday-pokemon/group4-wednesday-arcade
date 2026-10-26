// HTTP plumbing shared by every function: CORS, method/size checks, request ids, structured logs and
// typed error responses. Error body: { error: { code, message, retryable, details? }, requestId }.
import { corsHeaders } from './cors.ts';
import { HttpError, errorBody } from './errors.ts';
import { MAX_BODY_BYTES, parseJsonText } from './validation.ts';

export interface RequestContext {
  fn: string;
  requestId: string;
  log: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
}

export interface HandlerResult {
  status?: number;
  body: unknown;
  replay?: boolean;
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Reads a JSON body capped at `maxBytes` (default 4 KB; mystery-append-events passes a larger cap). */
export async function readJson(req: Request, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError('PAYLOAD_TOO_LARGE', `Body exceeds ${maxBytes} bytes`);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new HttpError('PAYLOAD_TOO_LARGE', `Body exceeds ${maxBytes} bytes`);
  }
  return parseJsonText(text);
}

export function serve(fn: string, handler: (req: Request, ctx: RequestContext) => Promise<HandlerResult>): void {
  Deno.serve(async (req: Request) => {
    const started = Date.now();
    const incomingId = req.headers.get('x-request-id');
    const requestId = incomingId && REQUEST_ID_RE.test(incomingId) ? incomingId : crypto.randomUUID();
    const log: RequestContext['log'] = (level, msg, extra) =>
      console[level === 'info' ? 'log' : level](JSON.stringify({ level, fn, requestId, msg, ...extra }));

    const cors = corsHeaders(req.headers.get('origin'), Deno.env.get('ALLOWED_ORIGINS'));
    const baseHeaders = { ...(cors ?? {}), 'x-request-id': requestId };
    let status = 500;
    try {
      if (cors === null) throw new HttpError('ORIGIN_NOT_ALLOWED', 'Origin not allowed');
      if (req.method === 'OPTIONS') {
        status = 204;
        return new Response(null, { status, headers: baseHeaders });
      }
      if (req.method !== 'POST') throw new HttpError('METHOD_NOT_ALLOWED', 'Use POST');
      const result = await handler(req, { fn, requestId, log });
      status = result.status ?? 200;
      const headers = result.replay ? { ...baseHeaders, 'x-idempotent-replay': 'true' } : baseHeaders;
      return jsonResponse(result.body, status, headers);
    } catch (err) {
      const httpErr = err instanceof HttpError ? err : new HttpError('INTERNAL', 'Unexpected server error');
      if (!(err instanceof HttpError)) {
        log('error', 'unhandled_exception', { error: err instanceof Error ? err.message : String(err) });
      }
      status = httpErr.status;
      return jsonResponse(errorBody(httpErr, requestId), status, baseHeaders);
    } finally {
      // Never log bodies, JWTs or seeds; status + latency only (RED metrics via log drains).
      log(status >= 500 ? 'error' : 'info', 'request_done', { method: req.method, status, durationMs: Date.now() - started });
    }
  });
}
