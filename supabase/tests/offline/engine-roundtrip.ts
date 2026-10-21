// Engine <-> database parity test (no Docker, no Deno). Drives the EXACT engine copy the Edge Functions run
// (supabase/functions/_shared/game) through many full races and commits every real GameState / LegResolution
// through the real RPCs inside PGlite, mirroring supabase/functions/_shared/session-flow.ts. Checks:
//  * every engine state is accepted by the SQL casts + CHECK constraints (incl. DNF, Enid, Dragapult, ...)
//  * column projections == engine state; snapshot round-trips exactly
//  * idempotent replay returns the stored response; stale revision rejected; closed sessions frozen
//  * draws redacted while in progress, revealed (with seed) at the end; draws never in leg_results.resolution
//  * exactly one leaderboard entry per finished session; DB ranking == engine rankLeaderboard()
//  * supersede + player abandon keep the station projection coherent
// Usage (after npm run sync:shared; see run-pglite.mjs for the PGlite install):
//   PGLITE_DIR=supabase/.cache/pglite npx tsx supabase/tests/offline/engine-roundtrip.ts [races=300]
import {
  CHARACTERS, POKEMON, abandonSession, buildSessionView, createInitialState, createStream, getPushOptions,
  prepareWithSeed, rankLeaderboard, resolveWithSeed,
} from '../../functions/_shared/game/index.ts';
import type { GameState, LegResolution, ScoreRecord, StationId } from '../../functions/_shared/game/index.ts';
import { generateSeed, sha256Hex } from '../../functions/_shared/crypto.ts';
import { redactResolution, redactView } from '../../functions/_shared/redact.ts';
import { jsonEqual } from '../../functions/_shared/validation.ts';
// @ts-expect-error plain ESM helper without types
import { bootDatabase } from './boot.mjs';
import { runMysteryRoundtrip } from './mystery-roundtrip.ts';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };

const RACES = Number(process.argv[2] ?? 300);
const rng = createStream('engine-roundtrip-v1');
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
let assertions = 0;
const failures: string[] = [];
function check(cond: unknown, msg: string): void {
  assertions++;
  if (!cond) failures.push(msg);
}

const db: Db = await bootDatabase({ pgliteDir: process.env.PGLITE_DIR ?? 'supabase/.cache/pglite', log: () => {} });
const actor = { userId: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'station', stationId: null as StationId | null };
let actionCounter = 0;
const nextActionId = () => `act_${(++actionCounter).toString().padStart(8, '0')}`;

function envelope(state: GameState, seed: string, commitment: string, stationId: StationId, reason: string | null, res?: LegResolution) {
  const out: Record<string, unknown> = {
    view: redactView(buildSessionView(state, seed, true, commitment)),
    meta: { sessionId: state.sessionId, stationId, status: state.status, abandonedReason: reason },
  };
  if (res) out.resolution = redactResolution(res, state.status === 'in_progress');
  return out;
}

async function commit(sessionId: string, rev: number, actionId: string, type: string, request: unknown, state: unknown, leg: unknown, response: unknown) {
  const r = await db.query(
    'select public.commit_session_transition($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb) as r',
    [sessionId, rev, actionId, type, JSON.stringify(request), JSON.stringify(state), leg ? JSON.stringify(leg) : null, JSON.stringify(response)],
  );
  return r.rows[0].r as Record<string, any>;
}

async function verifyRow(state: GameState, label: string) {
  const { rows } = await db.query('select * from public.sessions where id = $1', [state.sessionId]);
  const row = rows[0];
  check(row, `${label}: row exists`);
  check(row.revision === state.revision, `${label}: revision ${row.revision} vs ${state.revision}`);
  check(row.status === state.status && row.phase === state.phase, `${label}: status/phase`);
  check(row.leg_index === state.legIndex, `${label}: leg_index`);
  check(row.hp === state.hp && row.stamina === state.stamina && row.gap_m === state.pursuitGapM, `${label}: hp/stamina/gap`);
  check(row.hyde_catch_count === state.hydeCatchCount, `${label}: catches`);
  check(row.banked_egg_points === state.bankedEggPoints && row.unbanked_egg_points === state.unbankedEggPoints, `${label}: eggs`);
  check(row.total_simulated_time_cs === state.totalSimulatedTimeCs, `${label}: time`);
  if (state.status === 'completed' || state.status === 'dnf') {
    check(Number(row.final_score) === state.finalScore, `${label}: final_score ${row.final_score} vs ${state.finalScore}`);
    check(row.verified_at instanceof Date, `${label}: verified_at`);
  }
  check(jsonEqual(row.state, JSON.parse(JSON.stringify(state))), `${label}: snapshot round-trips`);
}

function checkRedaction(resp: Record<string, any>, state: GameState, seed: string, label: string) {
  const open = state.status === 'in_progress';
  const results = resp.view.state.legResults as Array<{ draws: unknown }>;
  check(results.every((r) => (open ? r.draws === null : r.draws !== null)), `${label}: draws redaction`);
  check(open ? resp.view.revealedSeed === null : resp.view.revealedSeed === seed, `${label}: seed reveal`);
  if (resp.resolution) check(open ? resp.resolution.draws === null : resp.resolution.draws !== null, `${label}: resolution draws`);
  check(!JSON.stringify(resp).includes(seed) || !open, `${label}: seed string absent while open`);
}

const finished: string[] = [];
for (let race = 0; race < RACES; race++) {
  const stationId: StationId = race % 2 === 0 ? 'station_a' : 'station_b';
  actor.stationId = stationId;
  const sessionId = crypto.randomUUID();
  const characterId = pick(CHARACTERS).id;
  const pokemonId = pick(POKEMON).id;
  let state = createInitialState({ sessionId, nickname: `Racer ${race}`, characterId, pokemonId });
  const seed = generateSeed();
  const commitment = await sha256Hex(seed);
  const createAction = nextActionId();
  const body = { nickname: state.nickname, characterId, pokemonId, actionId: createAction };
  const created = (await db.query(
    'select public.create_session_atomic($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, null) as r',
    [sessionId, stationId, createAction, seed, commitment, JSON.stringify(state),
     JSON.stringify({ body, actor }), JSON.stringify(envelope(state, seed, commitment, stationId, null))],
  )).rows[0].r;
  check(created.ok === true, `race ${race}: create ${JSON.stringify(created)}`);
  await db.query("update public.sessions set created_at = created_at - interval '5 minutes'"); // bypass rate limit
  await verifyRow(state, `race ${race} created`);

  const abandonAt = rng() < 0.08 ? 1 + Math.floor(rng() * 3) : 0; // some races are reset by the player
  while (state.status === 'in_progress') {
    if (abandonAt === state.legIndex && state.phase === 'awaiting_egg') {
      const next = abandonSession(state);
      const act = nextActionId();
      const resp = envelope(next, seed, commitment, stationId, 'player_reset');
      const out = await commit(sessionId, state.revision, act, 'abandon', { body: { sessionId, actionId: act, reason: 'player_reset' }, actor, abandonReason: 'player_reset' }, next, null, resp);
      check(out.ok, `race ${race}: abandon ${JSON.stringify(out)}`);
      state = next;
      const st = (await db.query('select status, notice from public.station_status where station_id = $1', [stationId])).rows[0];
      check(st.status === 'idle' && st.notice === 'player_reset', `race ${race}: station idle after player reset`);
      break;
    }
    if (state.phase === 'awaiting_route') {
      const legal = getPushOptions(state).filter((o) => o.isLegal);
      const choice = { route: pick(['safe', 'shortcut'] as const), pushLevel: pick(legal).pushLevel };
      const result = prepareWithSeed(state, seed, choice, state.revision);
      check(result.ok, `race ${race}: prepare rejected`);
      if (!result.ok) break;
      const act = nextActionId();
      const req = { body: { sessionId, expectedRevision: state.revision, ...choice, actionId: act }, actor };
      const resp = envelope(result.state, seed, commitment, stationId, null);
      checkRedaction(resp, result.state, seed, `race ${race} prepare`);
      const out = await commit(sessionId, state.revision, act, 'prepare', req, result.state, null, resp);
      check(out.ok && out.replay === false, `race ${race}: prepare commit ${JSON.stringify(out).slice(0, 200)}`);
      if (rng() < 0.3) {
        const again = await commit(sessionId, state.revision, act, 'prepare', req, result.state, null, { other: true });
        check(again.ok && again.replay === true && jsonEqual(again.response, JSON.parse(JSON.stringify(resp))), `race ${race}: prepare replay`);
      }
      if (rng() < 0.2) {
        const stale = await commit(sessionId, state.revision, nextActionId(), 'prepare', req, result.state, null, resp);
        check(stale.error === 'STALE_REVISION' && stale.currentRevision === result.state.revision, `race ${race}: stale prepare`);
      }
      state = result.state;
    } else {
      const offer = state.prepared!.selectedOffer;
      const egg = offer !== 'none' && rng() < 0.75 ? 'collect' : 'skip';
      const result = resolveWithSeed(state, seed, egg, state.revision);
      check(result.ok, `race ${race}: resolve rejected`);
      if (!result.ok) break;
      const act = nextActionId();
      const req = { body: { sessionId, expectedRevision: state.revision, eggDecision: egg, actionId: act }, actor };
      const resp = envelope(result.state, seed, commitment, stationId, null, result.resolution);
      checkRedaction(resp, result.state, seed, `race ${race} resolve`);
      const out = await commit(sessionId, state.revision, act, 'resolve', req, result.state, result.resolution, resp);
      check(out.ok && out.replay === false, `race ${race}: resolve commit ${JSON.stringify(out).slice(0, 300)}`);
      if (rng() < 0.3) {
        const again = await commit(sessionId, state.revision, act, 'resolve', req, result.state, result.resolution, { other: true });
        check(again.ok && again.replay === true && jsonEqual(again.response, JSON.parse(JSON.stringify(resp))), `race ${race}: resolve replay`);
      }
      const leg = (await db.query('select resolution, draws, leg_time_cs from public.leg_results where session_id = $1 and leg_index = $2',
        [sessionId, result.resolution.legIndex])).rows[0];
      check(leg && !('draws' in leg.resolution) && jsonEqual(leg.draws, result.resolution.draws), `race ${race}: leg_results draws split`);
      check(leg && leg.leg_time_cs === result.resolution.time.totalCs, `race ${race}: leg time`);
      state = result.state;
    }
    await verifyRow(state, `race ${race} r${state.revision}`);
  }

  if (state.status === 'completed' || state.status === 'dnf') {
    finished.push(sessionId);
    const closed = await commit(sessionId, state.revision, nextActionId(), 'resolve', { body: {}, actor }, state, null, {});
    check(closed.error === 'SESSION_CLOSED', `race ${race}: closed session frozen`);
    const st = (await db.query('select * from public.station_status where station_id = $1', [stationId])).rows[0];
    check(st.session_id === sessionId && st.status === state.status && Number(st.final_score) === state.finalScore, `race ${race}: station projection final`);
  }
}

// Supersede scenario on a fresh session
{
  const stationId: StationId = 'station_a';
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const initial: GameState[] = [];
  for (const id of ids) {
    const s = createInitialState({ sessionId: id, nickname: 'Superseded', characterId: 'enid', pokemonId: 'dragapult' });
    initial.push(s);
    const seed = generateSeed();
    const c = await sha256Hex(seed);
    const act = nextActionId();
    const r = (await db.query('select public.create_session_atomic($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, null) as r',
      [id, stationId, act, seed, c, JSON.stringify(s), JSON.stringify({ body: { act }, actor }), JSON.stringify({ v: 1 })])).rows[0].r;
    check(r.ok, 'supersede create');
  }
  const first = (await db.query('select status, abandoned_reason, state from public.sessions where id = $1', [ids[0]])).rows[0];
  check(first.status === 'abandoned' && first.abandoned_reason === 'superseded', 'superseded columns');
  check(jsonEqual(first.state, JSON.parse(JSON.stringify(abandonSession(initial[0])))), 'SQL supersede patch == engine abandonSession()');
}

// Leaderboard parity: one entry per finished session; DB order == engine rankLeaderboard()
const entries = (await db.query('select * from public.leaderboard_entries')).rows;
check(entries.length === finished.length, `leaderboard entries ${entries.length} vs finished ${finished.length}`);
const records: ScoreRecord[] = entries.map((e) => ({
  sessionId: e.session_id, nickname: e.nickname, stationId: e.station_id, characterId: e.character_id, pokemonId: e.pokemon_id,
  status: e.status, finalEggPoints: e.final_egg_points, totalSimulatedTimeCs: e.total_simulated_time_cs,
  finalScore: Number(e.final_score), completedAt: (e.verified_at as Date).toISOString(), verified: true, rulesVersion: 'v2.5',
}));
const engineOrder = rankLeaderboard(records).map((r) => r.sessionId);
const dbOrder = (await db.query('select session_id from public.verified_leaderboard')).rows.map((r) => r.session_id);
check(jsonEqual(engineOrder, dbOrder), 'verified_leaderboard order == engine rankLeaderboard order');
const dnfCount = (await db.query('select count(*)::int as n from public.defeated_log')).rows[0].n;
check(dnfCount + dbOrder.length === finished.length, 'completed + dnf == finished');

// mystery-v3.1: offers, event validation, finalize and standings through the real RPCs (also proves v2.5 is untouched)
const mysterySummary = await runMysteryRoundtrip(db, Math.max(60, Math.round(RACES / 2)), check);
console.log(mysterySummary);

const summary = (await db.query(`select status, count(*)::int n from public.sessions group by 1 order by 1`)).rows;
console.log(`races=${RACES} assertions=${assertions} sessions=${JSON.stringify(summary)} ranked=${dbOrder.length} dnf=${dnfCount}`);
if (failures.length) {
  console.log(`FAILED ${failures.length}:\n` + failures.slice(0, 25).join('\n'));
  process.exit(1);
}
console.log('ENGINE <-> DB ROUND-TRIP PASSED');
