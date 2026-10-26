// Unit tests for the Deno-free Edge Function helpers (errors, validation, redact, crypto, cors) and the
// RNG-leak regression. Run from the repo root:
//   npx vitest run --config supabase/tests/unit/vitest.config.mts
// (Requires `npm run sync:shared` first so supabase/functions/_shared/game exists.)
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: {
    include: ['supabase/tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
