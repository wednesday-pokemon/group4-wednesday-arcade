// Whether this build has the browser-safe Supabase settings (URL + anon/publishable key) for LIVE mode.
// Tiny on purpose: imported by the lazy station / board entry points before supabase-js is loaded.
export function liveConfigured(env: Record<string, unknown> = import.meta.env): boolean {
  return Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
}
