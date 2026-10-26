// Operator-only provisioning of Auth users + app_users role bindings (hosted or local).
// Run from the repo root (uses the project's @supabase/supabase-js). The service role key and passwords
// are read from the environment so they never land in shell history, argv or the repo.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//   PROVISION_PASSWORD='<12+ chars, upper+lower+digit>' \
//   node supabase/scripts/provision-users.mjs <station|operator> <station_a|station_b|-> <email>
//
// Examples:
//   ... node supabase/scripts/provision-users.mjs station  station_a station-a@regatta.example
//   ... node supabase/scripts/provision-users.mjs operator -         ops@regatta.example
// Re-running for an existing email rotates its password and re-binds its role (idempotent).
import { createClient } from '@supabase/supabase-js';

const [role, stationArg, email] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.PROVISION_PASSWORD;

function fail(msg) {
  console.error(`provision-users: ${msg}`);
  process.exit(1);
}

if (!url || !serviceKey) fail('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
if (!['station', 'operator'].includes(role)) fail('role must be "station" or "operator"');
const stationId = role === 'station' ? stationArg : null;
if (role === 'station' && !['station_a', 'station_b'].includes(stationId)) fail('station must be station_a or station_b');
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('a valid email is required');
if (!password || password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
  fail('PROVISION_PASSWORD must be >= 12 chars with upper, lower and digit');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserByEmail(target) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === target.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

let user = await findUserByEmail(email);
if (user) {
  const { error } = await admin.auth.admin.updateUserById(user.id, { password, ban_duration: 'none' });
  if (error) fail(`updateUserById: ${error.message}`);
  console.log(`updated existing user ${email}`);
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) fail(`createUser: ${error.message}`);
  user = data.user;
  console.log(`created user ${email}`);
}

const { error: bindError } = await admin
  .from('app_users')
  .upsert({ user_id: user.id, role, station_id: stationId }, { onConflict: 'user_id' });
if (bindError) fail(`app_users upsert: ${bindError.message}`);
console.log(`bound ${email} -> role=${role}${stationId ? ` station=${stationId}` : ''} (user_id ${user.id})`);
