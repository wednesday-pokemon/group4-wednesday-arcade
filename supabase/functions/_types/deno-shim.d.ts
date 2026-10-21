// Minimal Deno surface used by the Edge Functions, so `npm run typecheck:functions` can check them with tsc
// (the real runtime is Supabase's Deno). Keep in sync with the Deno APIs actually used.
declare namespace Deno {
  const env: { get(name: string): string | undefined };
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
