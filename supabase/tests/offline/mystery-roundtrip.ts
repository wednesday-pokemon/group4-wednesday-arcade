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
//  * overhaul (2026-10-23): the six telemetry types, noise source 'hazard' and hyde_mode 'gave_up' ride in the random
//    streams; forecasts of EVERY target (incl. egg_site / clue_area / hyde_zone / hyde_spawn) ride on the batches through
//    the real parseMysteryAppend and are stored exactly once despite resends; telemetry never changes the result
//  * Joseph Crackstone (2026-10-24): the four Crackstone telemetry types and curse cast / miss ride in the random
//    streams; landed curses (rule events) cost HP, never a catch; some DNFs are curse deaths (dnf 'hp_depleted');
//    crackstone_risk forecasts ride along (FORECAST_TARGETS); the finalize replay re-reads RULE_EVENT_TYPES (incl. curse)
//  * mystery-v4 (2026-10-24): 3 of 4 sessions are created as mystery-v4 (p_rules_version), 1 of 4 as mystery-v3.1 (the
//    previous bundle's default); v4 streams carry the director / Slurp / cabinet telemetry, Weems hints with a level,
//    enemy_detected and an enemy_hit after every catch / curse hit (+ Slurp attacks, incl. Slurp deaths with dnf.by); each
//    session is validated and scored under ITS OWN rules version; stored counts / defeated_by / breakdown ==
//    computeResult(); the v4 SQL score CHECK accepts every recomputed breakdown; standings parity per version;
//    mystery_leaderboard_v4 and mystery_top5 == the v4 finishers in compareResults order; v3.1 views never show a v4 row
//  * v2.5 tables are untouched by all of it
import { createStream } from '../../functions/_shared/game/index.ts';
import {
  RULE_EVENT_TYPES, applyBatch, initialProgress, progressFromRow, ruleFingerprint, splitResend, type ParsedEvent,
} from '../../functions/_shared/mystery-events.ts';
import {
  MYSTERY_RULES_VERSION, PLAYER_MAX_HP, caseVersions, computeOffer, computeResult, requireData, requireEggRules, resolveCase,
  rulesContext, sessionRulesVersion, type SessionCase,
} from '../../functions/_shared/mystery-rules.ts';
import { FORECAST_TARGETS, parseMysteryAppend } from '../../functions/_shared/mystery-validation.ts';
import { CASE_IDS, type CaseId, type MysteryRulesVersion } from '../../functions/_shared/mystery/types.ts';
import { compareResults, round1, scoreFor, scoreV4 } from '../../functions/_shared/mystery/scoring.ts';
import { HttpError } from '../../functions/_shared/errors.ts';
import { jsonEqual } from '../../functions/_shared/validation.ts';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
type Check = (cond: unknown, msg: string) => void;

/** SQL list of the rule event types finalize re-reads (mystery-db.ts loadRuleEvents filters on RULE_EVENT_TYPES). */
const RULE_TYPES = `(${RULE_EVENT_TYPES.map((t) => `'${t}'`).join(',')})`;

export async function runMysteryRoundtrip(db: Db, sessions: number, check: Check): Promise<string> {
  const rng = createStream('mystery-roundtrip-v1');
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const hex = () => Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join('');
  const uuid = () => { const h = hex(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
  requireData();
  const egg = requireEggRules();
  const versions = caseVersions();
  // + p_rules_version (20261025000100): the new mystery-create-session passes MYSTERY_RULES_VERSION
  const createCasts = ['::uuid', '', '', '', '', '::jsonb', '', '::jsonb', '::jsonb', '', ''];
  const actor = { userId: 'aaaaaaaa-0000-4000-8000-0000000000a1', role: 'station', stationId: null };
  const v25Before = (await db.query(`select (select count(*) from public.sessions) s, (select count(*) from public.leaderboard_entries) l,
    (select jsonb_agg(to_jsonb(x) order by station_id) from public.station_status x) st`)).rows[0];
  const rpc = async (fn: string, args: unknown[], casts: string[]) => {
    const placeholders = args.map((_, i) => `$${i + 1}${casts[i] ?? ''}`).join(', ');
    const out = await db.query(`select public.${fn}(${placeholders}) as r`, args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)));
    return out.rows[0].r as Record<string, any>;
  };
  const row = async (id: string) => (await db.query('select * from public.mystery_sessions where id = $1', [id])).rows[0];

  /** Mirrors mystery-append-events/index.ts (body parsed by the real parseMysteryAppend). Returns the error code or null. */
  async function append(sessionId: string, station: string, rawEvents: unknown[], rawForecasts: unknown[] = []): Promise<string | null> {
    try {
      const body = parseMysteryAppend({ sessionId, events: rawEvents, forecasts: rawForecasts });
      const events = body.events;
      const r = await row(sessionId);
      const resent = events.filter((e) => e.seq <= r.last_seq).map((e) => e.seq);
      const stored = new Map<number, ParsedEvent>();
      if (resent.length) {
        for (const s of (await db.query('select seq, t, type, payload from public.mystery_events where session_id = $1 and seq = any($2::int[])', [sessionId, resent])).rows) {
          stored.set(s.seq, { seq: s.seq, t: Number(s.t), type: s.type, payload: s.payload });
        }
      }
      const { fresh } = splitResend(events, r.last_seq, stored);
      if (fresh.length === 0 && body.forecasts.length === 0) return null;
      const next = applyBatch(progressFromRow(r.progress), fresh,
        rulesContext(r.seed, resolveCase(r.case_id, r.case_version).caseDef, egg, PLAYER_MAX_HP, sessionRulesVersion(r.rules_version)));
      const out = await rpc('mystery_append_events', [sessionId, station, r.last_seq, fresh, next, body.forecasts, null],
        ['::uuid', '', '::int', '::jsonb', '::jsonb', '::jsonb', '::jsonb']);
      return out.ok ? null : out.error;
    } catch (e) {
      if (e instanceof HttpError) return e.code;
      throw e;
    }
  }

  let finished = 0;
  let dnf = 0;
  let curseDnf = 0;
  let rejected = 0;
  let abandoned = 0;
  const perVersion: Record<MysteryRulesVersion, number> = { 'mystery-v3.1': 0, 'mystery-v4': 0 };
  let slurpDnf = 0;
  for (let n = 0; n < sessions; n++) {
    const station = n % 2 === 0 ? 'station_a' : 'station_b';
    const seed = hex();
    const id = uuid();
    const actionId = `mrt_${n.toString().padStart(6, '0')}`;
    const offer = computeOffer(seed);
    const body = { actionId, nickname: `Player${n % 1000}` };
    // mostly the deployed rules (mystery-v4); every 4th session is a legacy v3.1 one (the previous bundle's create path)
    const rv: MysteryRulesVersion = n % 4 === 3 ? 'mystery-v3.1' : MYSTERY_RULES_VERSION;
    const v4 = rv === 'mystery-v4';
    const created = await rpc('mystery_create_session', [id, station, actionId, seed, body.nickname, offer, false, { body, actor }, versions, null, rv],
      createCasts);
    check(created.ok && !created.replay && (CASE_IDS as readonly string[]).includes(created.caseId) && created.rulesVersion === rv,
      `#${n} create ok with a drawn case under ${rv}`);
    const kase: SessionCase = resolveCase(created.caseId, created.caseVersion);
    await db.query(`update public.mystery_sessions set created_at = created_at - interval '10 minutes' where id = $1`, [id]); // dodge the rate limit
    const otherSeed = hex(); // a retry generates a fresh seed/offer server-side; the replay must ignore both
    const again = await rpc('mystery_create_session', [uuid(), station, actionId, otherSeed, body.nickname, computeOffer(otherSeed), false, { body, actor }, versions, null, MYSTERY_RULES_VERSION],
      createCasts);
    check(again.replay === true && again.sessionId === id && again.caseId === created.caseId && again.rulesVersion === rv,
      `#${n} refresh with same actionId replays the same session, case and rules version`);
    const storedCards = (await db.query('select card from public.mystery_offered_duos where session_id = $1 order by slot', [id])).rows.map((r) => r.card);
    check(jsonEqual(storedCards, JSON.parse(JSON.stringify(offer.cards))), `#${n} stored offer == draftOffer(seed)`);

    if (rng() < 0.06) { abandoned++; continue; } // left on the card screen: superseded by the next create on this station
    const card = pick(offer.cards);
    const sel = await rpc('mystery_select_duo', [id, station, card.characterId, card.pokemonId, { body: {}, actor }], ['::uuid', '', '', '', '::jsonb']);
    check(sel.ok, `#${n} select an offered duo`);


    // ---- build a valid stream (shape of the session's rules version: v4 adds the final-wave events)
    const ctx = rulesContext(seed, kase.caseDef, egg, PLAYER_MAX_HP, rv);
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
    const enemies = ['hyde', 'crackstone', 'slurp'] as const;
    const cosmetic = () => pick([
      () => push('noise', { source: 'footstep', x: rng() * 90, z: rng() * 120, loudness: 0.35, radiusM: 7 }),
      () => push('stance', { stance: pick(['walk', 'crouch', 'sprint', 'idle']) }),
      () => push('hyde_mode', { from: 'PATROL', to: 'INVESTIGATE_SOUND', reason: 'heard_noise' }),
      () => push('hyde_sighted', { distanceM: rng() * 13 }),
      () => push('hint_requested'),
      () => push('ability_used', { key: 'F', abilityId: 'psychic_vision', kinds: ['reveal_clues'], success: true, detail: 'Two clues glow' }),
      // overhaul telemetry (never rule events)
      () => push('hyde_mode', { from: 'INVESTIGATE_SOUND', to: 'SEARCH', reason: 'gave_up' }),
      () => push('noise', { source: 'hazard', x: rng() * 90 - 45, z: rng() * 120 - 60, loudness: 0.8, radiusM: 14 }),
      () => push('hyde_emerged', { spawnId: pick(['sp_court', 'sp_crypt', 'sp_east']), x: rng() * 90 - 45, z: rng() * 120 - 60 }),
      () => push('site_checked', { site: pick(['clue', 'egg']), siteId: pick(['s_ft_desk', 'e_shed', 'e_vault']), found: rng() < 0.3 }),
      () => push('trace_found', { sourceId: pick(['ex_cracked_vial', 'botanical_residue']), siteId: pick(['e_shed', 'e_vault']) }),
      () => push('examined', { examineId: pick(['ex_cracked_vial', 'ex_books']) }),
      () => push('passage_opened', { passageId: 'p_bookcase' }),
      () => push('hazard_triggered', { hazardId: 'hz_searchlight_1' }),
      // Joseph Crackstone telemetry + curse cast / miss (cost no HP)
      () => push('crackstone_mode', { from: 'PATROL', to: pick(['INVESTIGATE', 'CHASE']), reason: pick(['saw_player', 'sensed_player', 'scan_hit']) }),
      () => push('crackstone_sighted', { via: pick(['sight', 'proximity', 'scan']), distanceM: rng() * 20 }),
      () => push('crackstone_lost'),
      () => push('crackstone_scan', { phase: pick(['warning', 'pulse']), radiusM: 14, hit: rng() < 0.3 }),
      () => push('curse', { phase: pick(['cast', 'miss']), hpLost: 0, blocked: false }),
      // final wave (v4 sessions): director / Slurp / cabinet telemetry, Weems hints with a level, detections (rule events)
      ...(v4 ? [
        () => push('enemy_spawned', { enemy: pick(enemies), spawnId: pick(['sp_vault', 'sp_crypt_gate', 'sp_east']), x: rng() * 60 - 30, z: rng() * 60 - 60 }),
        () => push('enemy_despawned', { enemy: pick(enemies), reason: pick(['far', 'cycle_done', 'encounter_resolved']) }),
        () => push('slurp_mode', { from: 'WANDER', to: pick(['INVESTIGATE', 'CHASE', 'SEARCH']), reason: pick(['saw_player', 'heard_noise', 'sensed_player']) }),
        () => push('cabinet', { spotId: pick(['cab_archive_1', 'cab_crypt_2']), action: pick(['enter', 'close', 'open', 'exit']), loud: rng() < 0.3 }),
        () => push('hint_requested', { level: pick([1, 2, 3]) }),
        () => push('enemy_detected', { enemy: pick(enemies), via: pick(['sight', 'sound', 'proximity', 'scan', 'witnessed_hide']) }),
      ] : []),
    ])();
    const feature = { egg_site: 'site', clue_area: 'area', hyde_zone: 'zone', hyde_spawn: 'spawn' } as Record<string, string>;
    let forecastNo = 0;
    /** 0–2 forecasts of random targets issued at time `at` (one row per candidate for the overhaul targets). */
    const forecastsAt = (at: number) => Array.from({ length: Math.floor(rng() * 3) }, () => {
      const target = pick(FORECAST_TARGETS);
      const features: Record<string, unknown> = { t_bucket: Math.round(at / 10) };
      if (feature[target]) features[feature[target]] = pick(['e_shed', 'a_greenhouse', 'z_mid', 'sp_court']);
      return { forecastNo: forecastNo++, t: at, target, value: target === 'eta_s' ? Math.round(rng() * 400) : Math.round(rng() * 1e4) / 1e4,
        modelLabel: target === 'detection_15s' ? 'ml' : 'rule_based', features };
    });
    // v4: every Hyde grab / landed curse is followed by its enemy_hit (same step); Slurp attacks are enemy_hit only
    let lastHit: (typeof enemies)[number] | null = null;
    const hit = (enemy: (typeof enemies)[number], hp: number, blocked = false) => {
      if (!v4) return;
      push('enemy_hit', { enemy, hpLost: hp, blocked }, 0);
      lastHit = enemy;
    };
    const dnfBy = () => (v4 && lastHit !== null && rng() < 0.7 ? { by: lastHit } : {});
    const clues = [...ctx.clueIds].sort(() => rng() - 0.5).slice(0, Math.floor(rng() * 4));
    let catches = 0;
    for (let i = 0; i < 6; i++) cosmetic();
    clues.forEach((c, i) => { cosmetic(); push('clue_found', { clueId: c, cluesFound: i + 1 }); });
    if (rng() < 0.5) { catches = 1; push('catch', { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }); hit('hyde', 35); }
    let hpLost = catches * 35;
    if (rng() < 0.4) { push('curse', { phase: 'hit', hpLost: 25, blocked: false }); hpLost += 25; hit('crackstone', 25); } // a landed curse (not a catch)
    if (rng() < 0.2) { push('curse', { phase: 'hit', hpLost: 0, blocked: true }); hit('crackstone', 0, true); } // blocked by block_grab
    if (v4 && rng() < 0.3) { hit('slurp', 0, true); } // a blocked Slurp lunge still counts as a hit
    if (v4 && hpLost < 60 && rng() < 0.3) { hpLost += 30; hit('slurp', 30); }
    const willDnf = rng() < 0.2;
    const death = !willDnf ? null : pick(v4 ? ['curse', 'catch', 'slurp'] as const : ['curse', 'catch'] as const);
    const curseDeath = death === 'curse' || death === 'slurp';
    if (death === 'curse') {
      while (hpLost < 100) { push('curse', { phase: 'hit', hpLost: 25, blocked: false }); hpLost += 25; hit('crackstone', 25); }
      push('dnf', { reason: 'hp_depleted', ...dnfBy() }, 0);
    } else if (death === 'slurp') {
      while (hpLost < 100) { push('noise', { source: 'impact', x: 0, z: 0, loudness: 0.5, radiusM: 5 }); hpLost += 25; hit('slurp', 25); }
      slurpDnf++;
      push('dnf', { reason: 'hp_depleted', ...(rng() < 0.7 ? { by: 'slurp' } : {}) }, 0);
    } else if (death === 'catch') {
      if (catches === 0) { push('catch', { catchNumber: 1, hpLost: 35, eggSecurityLost: 0, blocked: false }); hit('hyde', 35); }
      push('catch', { catchNumber: 2, hpLost: 35, eggSecurityLost: 0, blocked: false });
      hit('hyde', 35);
      push('dnf', { reason: 'second_catch', ...dnfBy() });
    } else {
      push('egg_pickup');
      if (rng() < 0.3) { push('egg_drop', { reason: 'grab', security: 70 }); push('egg_pickup'); }
      t += rng() < 0.1 ? 700 : 0; // a few very slow runs -> negative v3.1 scores / no v4 time bonus
      push('egg_delivered', { tier, points: egg.points[tier], security: rng() < 0.3 ? 70 : 100 }, rng() * 30);
      const deliveredT = evs[evs.length - 1].t as number;
      if (v4 && rng() < 0.2) cosmetic(); // a detection / hint in the deposit step still counts
      const suspect = rng() < 0.1 ? null : pick(ctx.suspectIds);
      // cite all found clues (sometimes one fewer, sometimes plus a case-file note): an honest client cites only citable ids
      let evidence: string[] = suspect === null ? [] : [...clues];
      if (suspect !== null && evidence.length > 0 && rng() < 0.2) evidence = evidence.slice(1);
      if (suspect !== null && rng() < 0.2) evidence.push(kase.caseDef.notes[0]!.id);
      const deductionCorrect = suspect !== null && evidence.length === 3 && kase.solution.supportingEvidence.every((c) => evidence.includes(c));
      const verdict = suspect === null ? 'not_accused'
        : suspect === culprit && clues.length === 3 && deductionCorrect ? 'case_solved' : 'egg_secured_mystery_unsolved';
      push('accusation', { suspectId: suspect, correct: suspect === culprit, cluesFound: clues.length, evidence, deductionCorrect }, 0);
      const count = (type: string) => evs.filter((e) => e.type === type).length;
      const claimed = v4
        ? scoreV4({ delivered: true, correct: suspect === culprit, cluesFound: clues.length, detections: count('enemy_detected'),
          hintsUsed: count('hint_requested'), hits: count('enemy_hit'), activeTimeS: round1(deliveredT) }).total
        : scoreFor(egg.points[tier], deliveredT);
      push('finish', { verdict, score: claimed }, 0);
    }

    // ---- optionally corrupt (validator must reject before the DB)
    const corrupt = rng() < 0.1;
    if (corrupt) {
      const kind = Math.floor(rng() * 3);
      if (kind === 0) evs.splice(1, 0, { ...(evs[1] as object), seq: (evs[0].seq as number) } as Record<string, unknown>); // duplicate seq in batch
      else if (kind === 1) evs.unshift({ type: 'egg_delivered', t: 0, seq: 0, tier, points: egg.points[tier], security: 100 }); // deliver w/o pickup
      else evs.push({ type: 'clue_found', t: t + 1, seq: seq + 1, clueId: 'master_key', cluesFound: 1 }); // after terminal / dup
    }

    // ---- send in random batches (with forecasts riding along), sometimes resending the previous batch
    let error: string | null = null;
    let prev: { events: Record<string, unknown>[]; forecasts: unknown[] } | null = null;
    const forecastNos = new Set<number>();
    for (let i = 0; i < evs.length && !error;) {
      const size = 1 + Math.floor(rng() * 12);
      const batch = { events: evs.slice(i, i + size), forecasts: [] as { forecastNo: number }[] };
      batch.forecasts = forecastsAt(batch.events[batch.events.length - 1].t as number);
      if (prev && rng() < 0.3) error = await append(id, station, prev.events, prev.forecasts); // network retry of an acknowledged batch
      if (!error) error = await append(id, station, batch.events, batch.forecasts);
      if (!error) batch.forecasts.forEach((f) => forecastNos.add(f.forecastNo));
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
    check(r.clues_found === clues.length && r.catches === (willDnf && !curseDeath ? 2 : catches), `#${n} clue/catch projections`);
    const fcStored = (await db.query('select count(*)::int c from public.mystery_forecasts where session_id = $1', [id])).rows[0].c;
    check(fcStored === forecastNos.size, `#${n} every forecast (all targets) stored exactly once despite resends (${fcStored} vs ${forecastNos.size})`);

    // ---- finalize (mirrors mystery-finalize/index.ts)
    const ruleEvents = (await db.query(`select seq, t, type, payload from public.mystery_events where session_id = $1 and type in ${RULE_TYPES} order by seq`, [id]))
      .rows.map((e) => ({ seq: e.seq, t: Number(e.t), type: e.type, payload: e.payload }) as ParsedEvent);
    const replayed = applyBatch(initialProgress(), ruleEvents, ctx);
    check(ruleFingerprint(replayed) === ruleFingerprint(progressFromRow(r.progress)), `#${n} re-validated rule events == stored progress`);
    const result = computeResult(replayed, kase, ctx.expectedTier, undefined, sessionRulesVersion(r.rules_version));
    check(result.claimMatches, `#${n} the honest client's claims match the server result (${rv})`);
    check(result.rulesVersion === rv && (v4 ? result.detections !== null && result.hits !== null : result.detections === null),
      `#${n} result computed under the session's own rules version`);
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
    check(res.rules_version === rv && res.hints_used === result.hintsUsed && res.detections === result.detections && res.hits === result.hits
      && res.defeated_by === result.defeatedBy && jsonEqual(res.score_breakdown, result.scoreBreakdown),
      `#${n} stored v4 columns (counts, defeated_by, breakdown) == computeResult()`);
    if (v4 && result.outcome === 'finished') {
      const b = result.scoreBreakdown!;
      check(b.total === result.score && result.score! >= 0, `#${n} v4 score = breakdown total, never negative`);
    }
    perVersion[rv]++;
    const fin2 = await rpc('mystery_finalize_session', [id, station, 0, { outcome: 'finished', score: 600 }, { body: {}, actor }],
      ['::uuid', '', '::int', '::jsonb', '::jsonb']);
    check(fin2.replay === true && jsonEqual(fin2.result, res), `#${n} second finalize returns the same row`);
    if (result.outcome === 'finished') finished++; else dnf++;
    if (result.dnfReason === 'hp_depleted') { curseDnf++; check(res.dnf_reason === 'hp_depleted' && res.catches === result.catches, `#${n} curse death stored as dnf hp_depleted`); }
  }

  // ---- the three cases, explicitly: solved / wrong suspect / forged evidence, through the real create (bag) path
  const scenarioCount = await runCaseScenarios(db, rpc, row, append, createCasts, versions, actor, uuid, hex, check);

  // ---- bag fairness: per station the case counts of all bag-drawn sessions never differ by more than one
  for (const st of ['station_a', 'station_b']) {
    const counts = (await db.query(`select case_id, count(*)::int c from public.mystery_sessions where station_id = $1 group by case_id`, [st])).rows;
    const cs = CASE_IDS.map((c) => counts.find((x) => x.case_id === c)?.c ?? 0);
    check(Math.max(...cs) - Math.min(...cs) <= 1, `${st}: case distribution ${cs.join('/')} is even (shuffled bag)`);
  }

  // ---- standings parity with the shared comparator, PER rules version (boards never mix versions)
  const rows = (await db.query('select r.session_id, r.outcome, r.score, r.active_time_s, r.finalized_at, r.rules_version from public.mystery_results r where not r.is_test')).rows;
  const ordered = (version: MysteryRulesVersion) => rows.filter((x) => x.rules_version === version)
    .map((x) => ({ id: x.session_id as string, outcome: x.outcome, score: x.score === null ? null : Number(x.score),
      activeTimeS: Number(x.active_time_s), at: new Date(x.finalized_at).getTime() }))
    .sort((a, b) => compareResults(a, b) || a.at - b.at || (a.id < b.id ? -1 : 1)).map((x) => x.id);
  let negatives = 0;
  for (const [version, view] of [['mystery-v3.1', 'mystery_standings'], ['mystery-v4', 'mystery_standings_v4']] as const) {
    const expected = ordered(version);
    const dbOrder = (await db.query(`select session_id from public.${view}`)).rows.map((x) => x.session_id);
    check(expected.length > 0 && jsonEqual(expected, dbOrder), `${view} order == shared compareResults() order of the ${version} rows only`);
    const firstDnf = dbOrder.findIndex((sid) => rows.find((x) => x.session_id === sid)!.outcome === 'dnf');
    check(firstDnf === -1 || dbOrder.slice(firstDnf).every((sid) => rows.find((x) => x.session_id === sid)!.outcome === 'dnf'),
      `${view}: every finisher (incl. negative / zero scores) is above every DNF`);
  }
  negatives = rows.filter((x) => x.outcome === 'finished' && Number(x.score) < 0).length;
  check(rows.filter((x) => x.rules_version === 'mystery-v4' && x.outcome === 'finished').every((x) => Number(x.score) >= 0), 'no v4 score is negative');
  // the v4 leaderboard and the home-page top 5 are exactly the v4 finishers in that order
  const v4Finishers = ordered('mystery-v4').filter((sid) => rows.find((x) => x.session_id === sid)!.outcome === 'finished');
  const board = (await db.query('select session_id from public.mystery_leaderboard_v4')).rows.map((x) => x.session_id);
  check(jsonEqual(board, v4Finishers), 'mystery_leaderboard_v4 == v4 finishers in compareResults order');
  const top5 = (await db.query('select session_id, rank from public.mystery_top5')).rows;
  check(jsonEqual(top5.map((x) => x.session_id), v4Finishers.slice(0, 5)) && top5.every((x, i) => x.rank <= i + 1),
    'mystery_top5 == the first five v4 finishers');
  const v31Board = (await db.query(`select count(*)::int c from public.mystery_leaderboard where rules_version <> 'mystery-v3.1'`)).rows[0].c;
  check(v31Board === 0, 'the v3.1 leaderboard never shows a v4 row');
  const defeated = (await db.query(`select count(*)::int c, count(defeated_by)::int named from public.mystery_defeated_v4`)).rows[0];
  check(defeated.c > 0 && defeated.named > 0, 'the v4 defeat log lists DNFs with the defeating monster');
  const v25After = (await db.query(`select (select count(*) from public.sessions) s, (select count(*) from public.leaderboard_entries) l,
    (select jsonb_agg(to_jsonb(x) order by station_id) from public.station_status x) st`)).rows[0];
  check(jsonEqual(v25Before, v25After), 'v2.5 sessions / leaderboard / station_status untouched by mystery traffic');
  const superseded = (await db.query(`select count(*)::int c from public.mystery_sessions where status = 'abandoned'`)).rows[0].c;
  const perCase = (await db.query(`select case_id, count(*)::int c from public.mystery_results group by case_id order by case_id`)).rows
    .map((x) => `${x.case_id}=${x.c}`).join(' ');
  const telemetry = (await db.query(`select count(*)::int c from public.mystery_events where type in
    ('hyde_emerged','site_checked','trace_found','examined','passage_opened','hazard_triggered')`)).rows[0].c;
  const perTarget = (await db.query(`select target, count(*)::int c from public.mystery_forecasts group by target order by target`)).rows;
  check(FORECAST_TARGETS.every((t) => perTarget.some((x) => x.target === t)), 'forecasts of every target were stored');
  check(telemetry > 0, 'overhaul telemetry events were stored');
  const finalWave = (await db.query(`select type, count(*)::int c from public.mystery_events where type in
    ('enemy_spawned','enemy_despawned','enemy_detected','enemy_hit','slurp_mode','cabinet') group by type order by type`)).rows;
  check(finalWave.length === 6, `every final-wave event type was stored (${finalWave.map((x) => x.type).join(',')})`);
  return `mystery sessions=${sessions} (v4=${perVersion['mystery-v4']} v3.1=${perVersion['mystery-v3.1']} finalized) finished=${finished} `
    + `(negative v3.1=${negatives}) dnf=${dnf} (hp deaths=${curseDnf}, slurp=${slurpDnf}) rejected=${rejected} left-on-cards=${abandoned} `
    + `abandoned(superseded)=${superseded} case-scenarios=${scenarioCount} results-per-case: ${perCase} `
    + `telemetry-events=${telemetry} final-wave: ${finalWave.map((x) => `${x.type}=${x.c}`).join(' ')} `
    + `forecasts: ${perTarget.map((x) => `${x.target}=${x.c}`).join(' ')}`;
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
    const created = await rpc('mystery_create_session', [id, station, actionId, seed, body.nickname, computeOffer(seed), false, { body, actor }, versions, null, MYSTERY_RULES_VERSION], createCasts);
    await db.query(`update public.mystery_sessions set created_at = created_at - interval '10 minutes' where id = $1`, [id]);
    check(created.ok === true, `case scenario #${n}: create ok`);
    const caseId = created.caseId as CaseId;
    const scenario = todo.get(caseId)!.shift();
    if (!scenario) continue; // this case is done; the next create draws another one
    const kase = resolveCase(caseId, created.caseVersion);
    const ctx = rulesContext(seed, kase.caseDef, egg, PLAYER_MAX_HP, MYSTERY_RULES_VERSION);
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
    evs.push({ type: 'finish', t, seq: seq++, verdict: 'case_solved',
      score: scoreV4({ delivered: true, correct: true, cluesFound: 3, detections: 0, hintsUsed: 0, hits: 0, activeTimeS: round1(t) }).total });
    check(await append(id, station, evs) === null, `${caseId}/${scenario}: events accepted`);
    const r = await row(id);
    const ruleEvents = (await db.query(`select seq, t, type, payload from public.mystery_events where session_id = $1 and type in ${RULE_TYPES} order by seq`, [id]))
      .rows.map((e) => ({ seq: e.seq, t: Number(e.t), type: e.type, payload: e.payload }) as ParsedEvent);
    const result = computeResult(applyBatch(initialProgress(), ruleEvents, ctx), kase, tier, undefined, sessionRulesVersion(r.rules_version));
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
