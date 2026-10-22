// mystery-v3.1 TypeScript <-> database parity (no Docker, no Deno). Drives the EXACT modules the mystery Edge
// Functions run (shared draftOffer, event validator, result recomputation) through the real RPCs in PGlite, mirroring
// supabase/functions/mystery-*/index.ts step by step. Called from engine-roundtrip.ts (npm run test:db:roundtrip).
// Checks:
//  * every server-computed offer is accepted by the SQL constraints; refresh (same actionId) returns the same offer
//    AND the same case; the case comes from the station's bag (per station, case counts never differ by more than 1)
//  * random valid event streams (cosmetic + rule events, gaps, resends of whole batches) are accepted; projections
//    (last_seq, clues, catches, sightings, egg state) == validator state; resends store nothing twice
//  * invalid streams are rejected by the validator BEFORE the database and leave nothing behind
//  * finalize: rule events reloaded from SQL re-validate to the same state; stored result == computeResult();
//    the SQL score CHECK accepts every recomputed score (incl. negative); second finalize returns the same row
//  * mystery_standings order == shared compareResults() (finishers by score/time above all DNFs)
//  * each of the three cases: correct accusation with all 3 clues + full evidence -> case_solved; wrong suspect ->
//    unsolved and stored; forged evidence dropped; second finalize returns the same row
//  * v2.5 tables are untouched by all of it
import { createStream } from '../../functions/_shared/game/index.ts';
import {
  applyBatch, initialProgress, parseEventBatch, progressFromRow, ruleFingerprint, splitResend, type ParsedEvent,
} from '../../functions/_shared/mystery-events.ts';
import {
  caseVersions, computeOffer, computeResult, requireData, requireEggRules, resolveCase, rulesContext, type SessionCase,
} from '../../functions/_shared/mystery-rules.ts';
import { CASE_IDS, type CaseId } from '../../functions/_shared/mystery/types.ts';
import { compareResults, scoreFor } from '../../functions/_shared/mystery/scoring.ts';
import { HttpError } from '../../functions/_shared/errors.ts';
import { jsonEqual } from '../../functions/_shared/validation.ts';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
type Check = (cond: unknown, msg: string) => void;

const RULE_TYPES = "('catch','clue_found','egg_pickup','egg_drop','egg_damage','egg_delivered','accusation','finish','dnf','hyde_sighted','hint_requested')";

export async function runMysteryRoundtrip(db: Db, sessions: number, check: Check): Promise<string> {
  const rng = createStream('mystery-roundtrip-v1');
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const hex = () => Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join('');
  const uuid = () => { const h = hex(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
  requireData();
  const egg = requireEggRules();
  const versions = caseVersions();
  const createCasts = ['::uuid', '', '', '', '', '::jsonb', '', '::jsonb', '::jsonb', ''];
  const actor = { userId: 'aaaaaaaa-0000-4000-8000-0000000000a1', role: 'station', stationId: null };
  const v25Before = (await db.query(`select (select count(*) from public.sessions) s, (select count(*) from public.leaderboard_entries) l,
    (select jsonb_agg(to_jsonb(x) order by station_id) from public.station_status x) st`)).rows[0];
  const rpc = async (fn: string, args: unknown[], casts: string[]) => {
    const placeholders = args.map((_, i) => `$${i + 1}${casts[i] ?? ''}`).join(', ');
    const out = await db.query(`select public.${fn}(${placeholders}) as r`, args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)));
    return out.rows[0].r as Record<string, any>;
  };
  const row = async (id: string) => (await db.query('select * from public.mystery_sessions where id = $1', [id])).rows[0];

  /** Mirrors mystery-append-events/index.ts. Returns the error code or null. */
  async function append(sessionId: string, station: string, rawEvents: unknown[]): Promise<string | null> {
    try {
      const events = parseEventBatch(rawEvents, false);
      const r = await row(sessionId);
      const resent = events.filter((e) => e.seq <= r.last_seq).map((e) => e.seq);
      const stored = new Map<number, ParsedEvent>();
      if (resent.length) {
        for (const s of (await db.query('select seq, t, type, payload from public.mystery_events where session_id = $1 and seq = any($2::int[])', [sessionId, resent])).rows) {
          stored.set(s.seq, { seq: s.seq, t: Number(s.t), type: s.type, payload: s.payload });
        }
      }
      const { fresh } = splitResend(events, r.last_seq, stored);
      if (fresh.length === 0) return null;
      const next = applyBatch(progressFromRow(r.progress), fresh, rulesContext(r.seed, resolveCase(r.case_id, r.case_version).caseDef, egg));
      const out = await rpc('mystery_append_events', [sessionId, station, r.last_seq, fresh, next, null, null],
        ['::uuid', '', '::int', '::jsonb', '::jsonb', '::jsonb', '::jsonb']);
      return out.ok ? null : out.error;
    } catch (e) {
      if (e instanceof HttpError) return e.code;
      throw e;
    }
  }

  let finished = 0;
  let dnf = 0;
  let rejected = 0;
  let abandoned = 0;
  for (let n = 0; n < sessions; n++) {
    const station = n % 2 === 0 ? 'station_a' : 'station_b';
    const seed = hex();
    const id = uuid();
    const actionId = `mrt_${n.toString().padStart(6, '0')}`;
    const offer = computeOffer(seed);
    const body = { actionId, nickname: `Player${n % 1000}` };
    const created = await rpc('mystery_create_session', [id, station, actionId, seed, body.nickname, offer, false, { body, actor }, versions, null],
      createCasts);
    check(created.ok && !created.replay && (CASE_IDS as readonly string[]).includes(created.caseId), `#${n} create ok with a drawn case`);
    const kase: SessionCase = resolveCase(created.caseId, created.caseVersion);
    await db.query(`update public.mystery_sessions set created_at = created_at - interval '10 minutes' where id = $1`, [id]); // dodge the rate limit
    const otherSeed = hex(); // a retry generates a fresh seed/offer server-side; the replay must ignore both
    const again = await rpc('mystery_create_session', [uuid(), station, actionId, otherSeed, body.nickname, computeOffer(otherSeed), false, { body, actor }, versions, null],
      createCasts);
    check(again.replay === true && again.sessionId === id && again.caseId === created.caseId,
      `#${n} refresh with same actionId replays the same session and case`);
    const storedCards = (await db.query('select card from public.mystery_offered_duos where session_id = $1 order by slot', [id])).rows.map((r) => r.card);
    check(jsonEqual(storedCards, JSON.parse(JSON.stringify(offer.cards))), `#${n} stored offer == draftOffer(seed)`);

    if (rng() < 0.06) { abandoned++; continue; } // left on the card screen: superseded by the next create on this station
    const card = pick(offer.cards);
    const sel = await rpc('mystery_select_duo', [id, station, card.characterId, card.pokemonId, { body: {}, actor }], ['::uuid', '', '', '', '::jsonb']);
    check(sel.ok, `#${n} select an offered duo`);

    // ---- build a valid stream
    const ctx = rulesContext(seed, kase.caseDef, egg);
    const culprit = kase.solution.culprit;
    const tier = ctx.expectedTier!;
    let seq = 0;
    let t = 0;
    const evs: Record<string, unknown>[] = [];
    const push = (type: string, payload: Record<string, unknown> = {}, dt = rng() * 4) => {
      t += dt;
      seq += rng() < 0.2 ? 2 : 1; // gaps: the client may drop cosmetic events
      evs.push({ type, t, seq, ...payload });
    };
    const cosmetic = () => pick([
      () => push('noise', { source: 'footstep', x: rng() * 90, z: rng() * 120, loudness: 0.35, radiusM: 7 }),
      () => push('stance', { stance: pick(['walk', 'crouch', 'sprint', 'idle']) }),
      () => push('hyde_mode', { from: 'PATROL', to: 'INVESTIGATE_SOUND', reason: 'heard_noise' }),
      () => push('hyde_sighted', { distanceM: rng() * 13 }),
      () => push('hint_requested'),
      () => push('ability_used', { key: 'F', abilityId: 'psychic_vision', kinds: ['reveal_clues'], success: true, detail: 'Two clues glow' }),
    ])();
    const clues = [...ctx.clueIds].sort(() => rng() - 0.5).slice(0, Math.floor(rng() * 4));
    let catches = 0;
    for (let i = 0; i < 6; i++) cosmetic();
    clues.forEach((c, i) => { cosmetic(); push('clue_found', { clueId: c, cluesFound: i + 1 }); });
    if (rng() < 0.5) { catches = 1; push('catch', { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }); }
    const willDnf = rng() < 0.2;
    if (willDnf) {
      if (catches === 0) push('catch', { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false });
      push('catch', { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false });
      push('dnf', { reason: 'second_catch' });
    } else {
      push('egg_pickup');
      if (rng() < 0.3) { push('egg_drop', { reason: 'grab', security: 70 }); push('egg_pickup'); }
      t += rng() < 0.1 ? 700 : 0; // a few very slow runs -> negative scores
      push('egg_delivered', { tier, points: egg.points[tier], security: rng() < 0.3 ? 70 : 100 }, rng() * 30);
      const suspect = rng() < 0.1 ? null : pick(ctx.suspectIds);
      // cite all found clues (sometimes one fewer, sometimes plus a case-file note): an honest client cites only citable ids
      let evidence = suspect === null ? [] : [...clues];
      if (suspect !== null && evidence.length > 0 && rng() < 0.2) evidence = evidence.slice(1);
      if (suspect !== null && rng() < 0.2) evidence.push(kase.caseDef.notes[0]!.id);
      const deductionCorrect = suspect !== null && evidence.length === 3 && kase.solution.supportingEvidence.every((c) => evidence.includes(c));
      const verdict = suspect === null ? 'not_accused'
        : suspect === culprit && clues.length === 3 && deductionCorrect ? 'case_solved' : 'egg_secured_mystery_unsolved';
      push('accusation', { suspectId: suspect, correct: suspect === culprit, cluesFound: clues.length, evidence, deductionCorrect }, 0);
      push('finish', { verdict, score: scoreFor(egg.points[tier], (evs[evs.length - 2].t as number)) }, 0);
    }

    // ---- optionally corrupt (validator must reject before the DB)
    const corrupt = rng() < 0.1;
    if (corrupt) {
      const kind = Math.floor(rng() * 3);
      if (kind === 0) evs.splice(1, 0, { ...(evs[1] as object), seq: (evs[0].seq as number) } as Record<string, unknown>); // duplicate seq in batch
      else if (kind === 1) evs.unshift({ type: 'egg_delivered', t: 0, seq: 0, tier, points: egg.points[tier], security: 100 }); // deliver w/o pickup
      else evs.push({ type: 'clue_found', t: t + 1, seq: seq + 1, clueId: 'master_key', cluesFound: 1 }); // after terminal / dup
    }

    // ---- send in random batches, sometimes resending the previous batch
    let error: string | null = null;
    let prev: Record<string, unknown>[] = [];
    for (let i = 0; i < evs.length && !error;) {
      const size = 1 + Math.floor(rng() * 12);
      const batch = evs.slice(i, i + size);
      if (prev.length && rng() < 0.3) error = await append(id, station, prev); // network retry of an acknowledged batch
      if (!error) error = await append(id, station, batch);
      prev = batch;
      i += size;
    }
    if (corrupt) {
      check(error === 'EVENT_REJECTED' || error === 'SEQ_CONFLICT', `#${n} corrupt stream rejected by the validator (got ${error})`);
      rejected++;
      continue;
    }
    check(error === null, `#${n} valid stream accepted (got ${error})`);

    // ---- projections
    const r = await row(id);
    const stored = (await db.query('select count(*)::int c from public.mystery_events where session_id = $1', [id])).rows[0].c;
    check(stored === evs.length && r.event_count === evs.length, `#${n} every event stored exactly once despite resends`);
    check(r.last_seq === evs[evs.length - 1].seq, `#${n} last_seq`);
    check(r.clues_found === clues.length && r.catches === (willDnf ? 2 : catches), `#${n} clue/catch projections`);

    // ---- finalize (mirrors mystery-finalize/index.ts)
    const ruleEvents = (await db.query(`select seq, t, type, payload from public.mystery_events where session_id = $1 and type in ${RULE_TYPES} order by seq`, [id]))
      .rows.map((e) => ({ seq: e.seq, t: Number(e.t), type: e.type, payload: e.payload }) as ParsedEvent);
    const replayed = applyBatch(initialProgress(), ruleEvents, ctx);
    check(ruleFingerprint(replayed) === ruleFingerprint(progressFromRow(r.progress)), `#${n} re-validated rule events == stored progress`);
    const result = computeResult(replayed, kase, ctx.expectedTier);
    check(result.claimMatches, `#${n} the honest client's claims match the server result`);
    const fin = await rpc('mystery_finalize_session', [id, station, r.last_seq, result, { body: { sessionId: id }, actor }],
      ['::uuid', '', '::int', '::jsonb', '::jsonb']);
    check(fin.ok && fin.replay === false, `#${n} finalize accepted by SQL constraints (${fin.error ?? ''} ${fin.message ?? ''})`);
    if (!fin.ok) continue;
    const res = fin.result;
    check(res.case_id === created.caseId && res.case_version === created.caseVersion && jsonEqual(res.evidence, result.evidence)
      && res.deduction_correct === result.deductionCorrect, `#${n} stored case / evidence / deduction == session + computeResult()`);
    check(res.outcome === result.outcome && res.verdict === result.verdict && res.accused === result.accused
      && res.correct === result.correct && jsonEqual(res.clues_found, result.cluesFound) && res.egg_tier === result.eggTier
      && res.egg_points === result.eggPoints && Number(res.active_time_s) === result.activeTimeS
      && (res.score === null ? result.score === null : Number(res.score) === result.score), `#${n} stored result == computeResult()`);
    const fin2 = await rpc('mystery_finalize_session', [id, station, 0, { outcome: 'finished', score: 600 }, { body: {}, actor }],
      ['::uuid', '', '::int', '::jsonb', '::jsonb']);
    check(fin2.replay === true && jsonEqual(fin2.result, res), `#${n} second finalize returns the same row`);
    if (result.outcome === 'finished') finished++; else dnf++;
  }

  // ---- the three cases, explicitly: solved / wrong suspect / forged evidence, through the real create (bag) path
  const scenarioCount = await runCaseScenarios(db, rpc, row, append, createCasts, versions, actor, uuid, hex, check);

  // ---- bag fairness: per station the case counts of all bag-drawn sessions never differ by more than one
  for (const st of ['station_a', 'station_b']) {
    const counts = (await db.query(`select case_id, count(*)::int c from public.mystery_sessions where station_id = $1 group by case_id`, [st])).rows;
    const cs = CASE_IDS.map((c) => counts.find((x) => x.case_id === c)?.c ?? 0);
    check(Math.max(...cs) - Math.min(...cs) <= 1, `${st}: case distribution ${cs.join('/')} is even (shuffled bag)`);
  }

  // ---- standings parity with the shared comparator
  const rows = (await db.query('select r.session_id, r.outcome, r.score, r.active_time_s, r.finalized_at from public.mystery_results r where not r.is_test')).rows;
  const expected = rows.map((x) => ({ id: x.session_id as string, outcome: x.outcome, score: x.score === null ? null : Number(x.score),
    activeTimeS: Number(x.active_time_s), at: new Date(x.finalized_at).getTime() }))
    .sort((a, b) => compareResults(a, b) || a.at - b.at || (a.id < b.id ? -1 : 1)).map((x) => x.id);
  const dbOrder = (await db.query('select session_id from public.mystery_standings')).rows.map((x) => x.session_id);
  check(jsonEqual(expected, dbOrder), 'mystery_standings order == shared compareResults() order');
  const firstDnf = dbOrder.findIndex((sid) => rows.find((x) => x.session_id === sid)!.outcome === 'dnf');
  const negatives = rows.filter((x) => x.outcome === 'finished' && Number(x.score) < 0).length;
  check(firstDnf === -1 || dbOrder.slice(firstDnf).every((sid) => rows.find((x) => x.session_id === sid)!.outcome === 'dnf'),
    'every finisher (incl. negative scores) is above every DNF');
  const v25After = (await db.query(`select (select count(*) from public.sessions) s, (select count(*) from public.leaderboard_entries) l,
    (select jsonb_agg(to_jsonb(x) order by station_id) from public.station_status x) st`)).rows[0];
  check(jsonEqual(v25Before, v25After), 'v2.5 sessions / leaderboard / station_status untouched by mystery traffic');
  const superseded = (await db.query(`select count(*)::int c from public.mystery_sessions where status = 'abandoned'`)).rows[0].c;
  const perCase = (await db.query(`select case_id, count(*)::int c from public.mystery_results group by case_id order by case_id`)).rows
    .map((x) => `${x.case_id}=${x.c}`).join(' ');
  return `mystery sessions=${sessions} finished=${finished} (negative=${negatives}) dnf=${dnf} rejected=${rejected} left-on-cards=${abandoned} `
    + `abandoned(superseded)=${superseded} case-scenarios=${scenarioCount} results-per-case: ${perCase}`;
}

type Rpc = (fn: string, args: unknown[], casts: string[]) => Promise<Record<string, any>>;

/**
 * For every case: (1) the culprit with all three clues and exactly the three clues cited -> case_solved; (2) a wrong
 * suspect -> egg_secured_mystery_unsolved, stored; (3) forged evidence ids are dropped and the claim flagged. Sessions are
 * created through the normal bag path on station_a (the bag guarantees every case within three creates); a second
 * finalize always returns the same row.
 */
async function runCaseScenarios(
  db: Db, rpc: Rpc, row: (id: string) => Promise<Record<string, any>>,
  append: (sessionId: string, station: string, rawEvents: unknown[]) => Promise<string | null>,
  createCasts: string[], versions: Record<CaseId, number>, actor: Record<string, unknown>, uuid: () => string, hex: () => string,
  check: Check,
): Promise<number> {
  const egg = requireEggRules();
  const todo = new Map<CaseId, string[]>(CASE_IDS.map((c) => [c, ['solved', 'wrong', 'forged']]));
  let played = 0;
  for (let n = 0; n < 40 && [...todo.values()].some((x) => x.length > 0); n++) {
    const station = 'station_a';
    const id = uuid();
    const seed = hex();
    const actionId = `mcs_${n.toString().padStart(6, '0')}`;
    const body = { actionId, nickname: `Case${n}` };
    const created = await rpc('mystery_create_session', [id, station, actionId, seed, body.nickname, computeOffer(seed), false, { body, actor }, versions, null], createCasts);
    await db.query(`update public.mystery_sessions set created_at = created_at - interval '10 minutes' where id = $1`, [id]);
    check(created.ok === true, `case scenario #${n}: create ok`);
    const caseId = created.caseId as CaseId;
    const scenario = todo.get(caseId)!.shift();
    if (!scenario) continue; // this case is done; the next create draws another one
    const kase = resolveCase(caseId, created.caseVersion);
    const ctx = rulesContext(seed, kase.caseDef, egg);
    const card = (await db.query('select card from public.mystery_offered_duos where session_id = $1 order by slot limit 1', [id])).rows[0].card;
    check((await rpc('mystery_select_duo', [id, station, card.characterId, card.pokemonId, { body: {}, actor }], ['::uuid', '', '', '', '::jsonb'])).ok,
      `${caseId}/${scenario}: select`);
    const tier = ctx.expectedTier!;
    const clues = kase.caseDef.clues.map((c) => c.id);
    const innocent = kase.caseDef.suspects.find((s) => s.id !== kase.solution.culprit)!.id;
    const suspect = scenario === 'wrong' ? innocent : kase.solution.culprit;
    const cited = scenario === 'forged' ? [clues[0]!, 'sabotaged_gate_forged', 'the_culprit', clues[1]!] : [...clues].reverse();
    const t = 120 + played * 7.3;
    let seq = 0;
    const evs: Record<string, unknown>[] = clues.map((c, i) => ({ type: 'clue_found', t: 10 + i, seq: seq++, clueId: c, cluesFound: i + 1 }));
    // the client CLAIMS a solved case every time (the server must overrule the wrong / forged ones)
    evs.push({ type: 'egg_pickup', t: 60, seq: seq++ });
    evs.push({ type: 'egg_delivered', t, seq: seq++, tier, points: egg.points[tier], security: 100 });
    evs.push({ type: 'accusation', t, seq: seq++, suspectId: suspect, correct: true, cluesFound: 3, evidence: cited, deductionCorrect: true });
    evs.push({ type: 'finish', t, seq: seq++, verdict: 'case_solved', score: scoreFor(egg.points[tier], t) });
    check(await append(id, station, evs) === null, `${caseId}/${scenario}: events accepted`);
    const r = await row(id);
    const ruleEvents = (await db.query(`select seq, t, type, payload from public.mystery_events where session_id = $1 and type in ${RULE_TYPES} order by seq`, [id]))
      .rows.map((e) => ({ seq: e.seq, t: Number(e.t), type: e.type, payload: e.payload }) as ParsedEvent);
    const result = computeResult(applyBatch(initialProgress(), ruleEvents, ctx), kase, tier);
    const fin = await rpc('mystery_finalize_session', [id, station, r.last_seq, result, { body: { sessionId: id }, actor }], ['::uuid', '', '::int', '::jsonb', '::jsonb']);
    check(fin.ok && fin.replay === false, `${caseId}/${scenario}: finalize accepted (${fin.error ?? ''} ${fin.message ?? ''})`);
    const res = fin.result ?? {};
    check(res.case_id === caseId, `${caseId}/${scenario}: stored under the session's case`);
    if (scenario === 'solved') {
      check(res.verdict === 'case_solved' && res.correct === true && res.deduction_correct === true && res.clue_count === 3
        && result.claimMatches, `${caseId}: culprit + all clues + full evidence -> case_solved`);
    } else if (scenario === 'wrong') {
      check(res.verdict === 'egg_secured_mystery_unsolved' && res.correct === false && res.accused === innocent && !result.claimMatches,
        `${caseId}: wrong suspect -> unsolved, stored, the client's "correct" claim overruled`);
    } else {
      check(jsonEqual(res.evidence, [clues[0], clues[1]]) && res.deduction_correct === false && res.verdict === 'egg_secured_mystery_unsolved'
        && !result.claimMatches, `${caseId}: forged evidence ids dropped, deduction not credited`);
    }
    const again = await rpc('mystery_finalize_session', [id, station, 0, { outcome: 'finished', verdict: 'case_solved', score: 999 }, { body: {}, actor }],
      ['::uuid', '', '::int', '::jsonb', '::jsonb']);
    check(again.replay === true && jsonEqual(again.result, res), `${caseId}/${scenario}: second finalize returns the same row`);
    const second = await append(id, station, [{ type: 'accusation', t: t + 1, seq: seq + 1, suspectId: kase.solution.culprit, correct: true,
      cluesFound: 3, evidence: clues, deductionCorrect: true }]);
    check(second !== null, `${caseId}/${scenario}: a second accusation is refused (${second})`);
    played++;
  }
  check([...todo.values()].every((x) => x.length === 0), 'every case played solved / wrong / forged');
  return played;
}
