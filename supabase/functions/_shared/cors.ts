// CORS. Pure module. Auth uses a bearer header (no cookies), so a wildcard origin does not enable CSRF;
// still, set ALLOWED_ORIGINS (comma-separated) in production to pin the kiosk/dashboard origins.

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type, x-request-id';

/**
 * Returns CORS headers for this request, or null when the request carries an Origin that is not allowed.
 * `allowList` is the raw ALLOWED_ORIGINS value; empty/undefined/"*" allows any origin.
 */
export function corsHeaders(origin: string | null, allowList: string | undefined): Record<string, string> | null {
  const base: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'x-request-id, x-idempotent-replay',
    'Access-Control-Max-Age': '600',
  };
  const list = (allowList ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0 || list.includes('*')) return { ...base, 'Access-Control-Allow-Origin': '*' };
  if (origin === null) return { ...base, Vary: 'Origin' }; // non-browser caller (curl, tests)
  if (!list.includes(origin)) return null;
  return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}
