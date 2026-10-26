// Overhaul backend (2026-10-23, docs/overhaul/OVERHAUL_CONTRACT.md §Backend): the six telemetry event types, noise source
// 'hazard', the new forecast targets, case content version 2 — plus drift guards that compare the server's enums with the
// synced src/mystery/types.ts and with the SQL CHECK lists of the migrations, so a sim/validator/DB mismatch fails HERE
// instead of turning a live run "unverified" at the booth. Run after `npm run sync:shared`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../functions/_shared/errors.ts';
import {
  CRACKSTONE_MODES, CRACKSTONE_REASONS, CRACKSTONE_SCAN_PHASES, CRACKSTONE_VIA, CURSE_PHASES, HYDE_MODES, HYDE_REASONS,
  MYSTERY_EVENT_TYPES, NOISE_SOURCES, OVERHAUL_TELEMETRY_TYPES, ROOMS, RULE_EVENT_TYPES, SAFE_ID_RE, STANCES, applyBatch,
  eventFieldNames, initialProgress, isStrictEvent, parseEvent, parseEventBatch, ruleFingerprint, type MysteryEventType,
  type ParsedEvent, type RulesContext,
} from '../../functions/_shared/mystery-events.ts';
import { computeResult, requireData, resolveCase } from '../../functions/_shared/mystery-rules.ts';
import { FORECAST_TARGETS, parseForecast, parseMysteryAppend } from '../../functions/_shared/mystery-validation.ts';
import { CASE_WORLDS } from '../../functions/_shared/mystery/data/caseWorlds.ts';
import { scoreFor } from '../../functions/_shared/mystery/scoring.ts';
import { CASE_IDS, SUSPECT_IDS } from '../../functions/_shared/mystery/types.ts';

/** These tests pin the LEGACY mystery-v3.1 rules (v3.1 history stays verifiable/readable); v4 lives in mystery-v4.test.ts. */
const V31 = 'mystery-v3.1' as const;
const computeV31 = (...a: [Parameters<typeof computeResult>[0], Parameters<typeof computeResult>[1], Parameters<typeof computeResult>[2], Parameters<typeof computeResult>[3]?]) =>
  computeResult(a[0], a[1], a[2], a[3], V31);

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return `${e.code}:${(e.details?.rule as string) ?? (e.details?.field as string) ?? ''}`;
    throw e;
  }
  return 'no-error';
}

const ev = (type: string, payload: Record<string, unknown> = {}, seq = 0, t = 1) => parseEvent({ type, t, seq, ...payload }, 0);

/** One valid payload per overhaul telemetry type (exact shapes of the GameEvent union). */
const SAMPLES: Record<string, Record<string, unknown>> = {
  hyde_emerged: { spawnId: 'sp_court', x: -2, z: -42.5 },
  site_checked: { site: 'egg', siteId: 'e_shed', found: false },
  trace_found: { sourceId: 'botanical_residue', siteId: 'e_vault' },
  examined: { examineId: 'ex_cracked_vial' },
  passage_opened: { passageId: 'p_bookcase' },
  hazard_triggered: { hazardId: 'hz_searchlight_1' },
};

// ------------------------------------------------------------------------------------------------- telemetry parsing
describe('overhaul telemetry events', () => {
  it('accepts each new type with its exact payload', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...OVERHAUL_TELEMETRY_TYPES].sort());
    for (const [type, payload] of Object.entries(SAMPLES)) {
      expect(ev(type, payload)).toEqual({ seq: 0, t: 1, type, payload });
    }
    expect(ev('site_checked', { site: 'clue', siteId: 's_ft_desk', found: true }).payload.found).toBe(true);
  });

  it('every declared field is required and typed', () => {
    for (const [type, payload] of Object.entries(SAMPLES)) {
      for (const key of Object.keys(payload)) {
        const { [key]: _drop, ...missing } = payload;
        expect(code(() => ev(type, missing)), `${type} without ${key}`).toBe('EVENT_REJECTED:payload');
      }
    }
    expect(code(() => ev('site_checked', { ...SAMPLES.site_checked, site: 'clue_site' }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => ev('site_checked', { ...SAMPLES.site_checked, found: 'yes' }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => ev('site_checked', { ...SAMPLES.site_checked, found: 1 }))).toBe('EVENT_REJECTED:payload');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1e5, -1001, '3', null]) {
      expect(code(() => ev('hyde_emerged', { ...SAMPLES.hyde_emerged, x: bad })), `x = ${String(bad)}`).toBe('EVENT_REJECTED:payload');
    }
  });

  it('ids must be snake_case and at most 40 characters', () => {
    expect(SAFE_ID_RE.test('a')).toBe(true);
    expect(SAFE_ID_RE.test(`a${'b'.repeat(39)}`)).toBe(true);
    for (const bad of ['E_Shed', 'e-shed', '1site', '_site', 'site id', '', `a${'b'.repeat(40)}`, 'é_site', 42, null, ['e_shed'], { id: 'e_shed' }]) {
      for (const [type, key] of [['site_checked', 'siteId'], ['trace_found', 'sourceId'], ['examined', 'examineId'],
        ['passage_opened', 'passageId'], ['hazard_triggered', 'hazardId'], ['hyde_emerged', 'spawnId']] as const) {
        expect(code(() => ev(type, { ...SAMPLES[type], [key]: bad })), `${type}.${key} = ${JSON.stringify(bad)}`).toBe('EVENT_REJECTED:payload');
      }
    }
  });

  it('like every telemetry type: tolerates ≤ 6 extra short primitives, never objects or arrays', () => {
    expect(ev('examined', { examineId: 'ex_vial', areaId: 'a_lab', dt: 1.5 }).payload).toEqual({ examineId: 'ex_vial', areaId: 'a_lab', dt: 1.5 });
    expect(code(() => ev('examined', { examineId: 'ex_vial', at: { x: 1 } }))).toBe('EVENT_REJECTED:payload');
    expect(code(() => ev('site_checked', { ...SAMPLES.site_checked, near: ['a'] }))).toBe('EVENT_REJECTED:payload');
    const seven = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`k${i}`, i]));
    expect(code(() => ev('hazard_triggered', { hazardId: 'hz_1', ...seven }))).toBe('EVENT_REJECTED:payload');
  });

  it("noise source 'hazard' (searchlight alarm) is accepted on noise and hyde_heard; unknown sources are not", () => {
    expect(ev('noise', { source: 'hazard', x: 10, z: -3, loudness: 0.8, radiusM: 14 }).payload.source).toBe('hazard');
    expect(ev('hyde_heard', { source: 'hazard', loudness: 0.8, distanceM: 9, occluded: false }).payload.source).toBe('hazard');
    expect(code(() => ev('noise', { source: 'searchlight', x: 0, z: 0, loudness: 0.8, radiusM: 14 }))).toBe('EVENT_REJECTED:payload');
  });

  it("hyde_mode reason 'gave_up' is accepted (regression: the sim emits it, the server used to reject the batch)", () => {
    expect(ev('hyde_mode', { from: 'INVESTIGATE_SOUND', to: 'SEARCH', reason: 'gave_up' }).payload.reason).toBe('gave_up');
  });
});

// ------------------------------------------------------------------------------------------------- not rule events
describe('overhaul telemetry is analytics-only (never changes the verified result)', () => {
  const data = requireData();
  const kase = resolveCase('poisoned_archive', data.cases.poisoned_archive.version);
  const clues = kase.caseDef.clues.map((c) => c.id);
  const ctx: RulesContext = { clueIds: clues, suspectIds: ['thornhill', 'isaac', 'barry'], eggPoints: { common: 1, rare: 3, legendary: 6 }, expectedTier: 'rare' };

  /** A solved run; `withTelemetry` interleaves every overhaul type (and a hazard noise) between the rule events. */
  function stream(withTelemetry: boolean): ParsedEvent[] {
    const raw: Record<string, unknown>[] = [];
    let seq = 0;
    const push = (type: string, t: number, payload: Record<string, unknown> = {}) => raw.push({ type, t, seq: seq++, ...payload });
    const tele = (t: number) => {
      if (!withTelemetry) return;
      for (const [type, payload] of Object.entries(SAMPLES)) push(type, t, payload);
      push('noise', t, { source: 'hazard', x: 1, z: 2, loudness: 0.7, radiusM: 12 });
    };
    tele(5);
    clues.forEach((c, i) => { push('clue_found', 10 + i, { clueId: c, cluesFound: i + 1 }); tele(10 + i); });
    push('egg_pickup', 60);
    tele(61);
    push('egg_delivered', 99, { tier: 'rare', points: 3, security: 100 });
    tele(99); // the player may still trip a searchlight at the tower before accusing
    push('accusation', 99, { suspectId: 'thornhill', correct: true, cluesFound: 3, evidence: [...clues], deductionCorrect: true });
    push('finish', 99, { verdict: 'case_solved', score: scoreFor(3, 99) });
    return parseEventBatch(raw, false);
  }

  it('none of the six types is a rule event', () => {
    expect(OVERHAUL_TELEMETRY_TYPES.filter((t) => RULE_EVENT_TYPES.includes(t))).toEqual([]);
    expect(OVERHAUL_TELEMETRY_TYPES.every((t) => MYSTERY_EVENT_TYPES.includes(t))).toBe(true);
  });

  it('interleaved telemetry leaves the rule state, the finalize replay and the result unchanged', () => {
    const full = stream(true);
    // same seqs without the telemetry (seq gaps are allowed: the client may drop cosmetic events)
    const telemetry = new Set<string>([...OVERHAUL_TELEMETRY_TYPES, 'noise']);
    const plain = applyBatch(initialProgress(), full.filter((e) => !telemetry.has(e.type)), ctx);
    const withTele = applyBatch(initialProgress(), full, ctx);
    expect(ruleFingerprint(withTele)).toBe(ruleFingerprint(plain));
    // finalize re-validates only the RULE events from the database: same state as the incremental append-time one
    const replay = applyBatch(initialProgress(), full.filter((e) => RULE_EVENT_TYPES.includes(e.type)), ctx);
    expect(ruleFingerprint(replay)).toBe(ruleFingerprint(withTele));
    const a = computeV31(plain, kase, 'rare');
    const b = computeV31(withTele, kase, 'rare');
    expect(b).toEqual(a);
    expect(b).toMatchObject({ verdict: 'case_solved', score: scoreFor(3, 99), claimMatches: true });
  });

  it('telemetry after the terminal event is refused like any other event', () => {
    const full = stream(false);
    const last = full[full.length - 1];
    expect(code(() => applyBatch(initialProgress(), [...full, ev('hazard_triggered', { hazardId: 'hz_1' }, last.seq + 1, last.t)], ctx)))
      .toBe('EVENT_REJECTED:after_terminal');
  });
});

// ------------------------------------------------------------------------------------------------- drift guards
const sharedTypes = readFileSync(join(ROOT, 'supabase/functions/_shared/mystery/types.ts'), 'utf8');
const literals = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
/** String literals of a single-line `export type Name = 'a' | 'b';` union. */
function unionOf(name: string): string[] {
  const m = sharedTypes.match(new RegExp(`export type ${name} =([^;]*);`));
  if (!m) throw new Error(`type ${name} not found in the synced types.ts`);
  return literals(m[1]);
}
const gameEventBlock = (() => {
  const start = sharedTypes.indexOf('export type GameEvent =');
  const end = sharedTypes.indexOf('};', start);
  if (start < 0 || end < 0) throw new Error('GameEvent union not found in the synced types.ts');
  return sharedTypes.slice(start, end + 2);
})();
const sorted = (xs: readonly string[]) => [...new Set(xs)].sort();

describe('server enums == the synced src/mystery/types.ts unions', () => {
  it('every GameEvent type is a server event type and vice versa', () => {
    const types = [...gameEventBlock.matchAll(/type: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(20);
    expect(sorted(MYSTERY_EVENT_TYPES)).toEqual(sorted(types));
  });
  it('NoiseSource, Stance, RoomId, HydeMode and the hyde_mode reasons match', () => {
    expect(sorted(NOISE_SOURCES)).toEqual(sorted(unionOf('NoiseSource')));
    expect(sorted(STANCES)).toEqual(sorted(unionOf('Stance')));
    expect(sorted(ROOMS)).toEqual(sorted(unionOf('RoomId')));
    expect(sorted(HYDE_MODES)).toEqual(sorted(unionOf('HydeMode')));
    const hydeMode = gameEventBlock.split('\n').find((l) => l.includes("type: 'hyde_mode'"));
    expect(hydeMode).toBeDefined();
    expect(sorted(HYDE_REASONS)).toEqual(sorted(literals(hydeMode!.slice(hydeMode!.indexOf('reason:')))));
  });
  it("site_checked.site is 'clue' | 'egg'", () => {
    const line = gameEventBlock.split('\n').find((l) => l.includes("type: 'site_checked'"))!;
    expect(sorted(literals(line.slice(line.indexOf('site:'), line.indexOf('siteId'))))).toEqual(['clue', 'egg']);
  });
  it('CrackstoneMode, CrackstoneDetectVia, CrackstoneModeReason and the scan / curse phases match (enemy contract)', () => {
    expect(sorted(CRACKSTONE_MODES)).toEqual(sorted(unionOf('CrackstoneMode')));
    expect(sorted(CRACKSTONE_VIA)).toEqual(sorted(unionOf('CrackstoneDetectVia')));
    expect(sorted(CRACKSTONE_REASONS)).toEqual(sorted(unionOf('CrackstoneModeReason')));
    const line = (type: string) => gameEventBlock.split('\n').find((l) => l.includes(`type: '${type}'`))!;
    // crackstone_mode / crackstone_sighted reference the named unions (so the checks above cover them)
    expect(line('crackstone_mode')).toMatch(/from: CrackstoneMode; to: CrackstoneMode; reason: CrackstoneModeReason/);
    expect(line('crackstone_sighted')).toMatch(/via: CrackstoneDetectVia/);
    const scan = line('crackstone_scan');
    expect(sorted(CRACKSTONE_SCAN_PHASES)).toEqual(sorted(literals(scan.slice(scan.indexOf('phase:'), scan.indexOf('radiusM')))));
    const curse = line('curse');
    expect(sorted(CURSE_PHASES)).toEqual(sorted(literals(curse.slice(curse.indexOf('phase:'), curse.indexOf('hpLost')))));
  });
  it('every GameEvent member declares exactly the payload keys the server schema validates', () => {
    // A key the sim adds to a STRICT (rule) type would reject the whole batch; a key the server requires but the sim
    // dropped would reject every event of that type. Single-line members only (all of them are).
    const mismatches: string[] = [];
    for (const l of gameEventBlock.split('\n')) {
      const m = l.match(/\{\s*type: '([a-z_]+)';?([^}]*)\}/);
      if (!m) continue;
      const keys = [...m[2].matchAll(/(\w+)\??:/g)].map((k) => k[1]);
      const server = eventFieldNames(m[1] as MysteryEventType);
      if (sorted(keys).join() !== sorted(server).join()) mismatches.push(`${m[1]}: types.ts [${keys}] vs server [${server}]`);
    }
    expect(mismatches).toEqual([]);
    expect(isStrictEvent('curse'), 'curse is a rule event with an exact payload').toBe(true);
  });
});

const MIGRATIONS = join(ROOT, 'supabase/migrations');
/** The literal list of the LATEST definition (migration order) of a `<constraint> check (<col> in (...))`. */
function latestCheckList(constraint: string, column: string): string[] {
  let last: string[] | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const m of sql.matchAll(new RegExp(`${constraint}\\s+check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, 'gi'))) last = literals(m[1]);
  }
  if (!last) throw new Error(`${constraint} not found in supabase/migrations`);
  return last;
}

describe('server enums == the SQL CHECK lists (latest migration wins)', () => {
  it('mystery_events_type_check == MYSTERY_EVENT_TYPES', () => {
    expect(sorted(latestCheckList('mystery_events_type_check', 'type'))).toEqual(sorted(MYSTERY_EVENT_TYPES));
  });
  it('mystery_forecasts_target_check == FORECAST_TARGETS', () => {
    expect(sorted(latestCheckList('mystery_forecasts_target_check', 'target'))).toEqual(sorted(FORECAST_TARGETS));
  });
  it('the rule-event partial index (latest definition) lists exactly RULE_EVENT_TYPES (telemetry never joins it)', () => {
    let last: string[] | null = null;
    let where = '';
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      for (const m of sql.matchAll(/create index mystery_events_rule_idx[^;]*?where type in \(([^)]*)\)/gi)) { last = literals(m[1]); where = file; }
    }
    expect(last, 'mystery_events_rule_idx defined in supabase/migrations').not.toBeNull();
    expect(where).toBe('20261025000100_mystery_v4.sql');
    expect(sorted(last!)).toEqual(sorted(RULE_EVENT_TYPES));
    expect(RULE_EVENT_TYPES).toContain('curse');
  });
});

// ------------------------------------------------------------------------------------------------- forecasts
describe('forecast targets', () => {
  const fc = (target: string, value: number, features: Record<string, unknown> = {}) =>
    ({ forecastNo: 0, t: 30, target, value, modelLabel: 'rule_based', features });
  /** Record-level check (throws); inside an append body the same failure drops the record instead. */
  const parse = (f: ReturnType<typeof fc>) => {
    const one = parseForecast(f, 0);
    const body = parseMysteryAppend({ sessionId: SID, events: [], forecasts: [f] });
    expect(body.forecasts).toEqual([one]);
    return one;
  };

  it('accepts every target; the overhaul ones as probabilities with a flat candidate feature', () => {
    expect([...FORECAST_TARGETS]).toEqual(['detection_15s', 'extraction', 'eta_s', 'egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn',
      'crackstone_risk', 'slurp_risk', 'enemy_spawn']);
    expect(parse(fc('crackstone_risk', 0.27, { horizon_s: 10, area: 'archive_stacks', mode: 'PATROL' })).target).toBe('crackstone_risk');
    expect(parse(fc('egg_site', 0.5, { site: 'e_shed', prior: 0.5, traces: 2, ruled_out: false })))
      .toMatchObject({ target: 'egg_site', value: 0.5, features: { site: 'e_shed' } });
    expect(parse(fc('clue_area', 0.82, { area: 'a_greenhouse' })).target).toBe('clue_area');
    expect(parse(fc('hyde_zone', 0.31, { zone: 'z_mid', phase: 'active' })).target).toBe('hyde_zone');
    expect(parse(fc('hyde_spawn', 0.2, { spawn: 'sp_court', emerges_in_s: 12 })).target).toBe('hyde_spawn');
    expect(parse(fc('extraction', 0.66, { carried: true })).target).toBe('extraction');
    expect(parse(fc('eta_s', 140)).value).toBe(140);
  });
  it('rejects out-of-range probabilities, unknown targets and nested features', () => {
    for (const target of ['egg_site', 'clue_area', 'hyde_zone', 'hyde_spawn', 'crackstone_risk', 'slurp_risk', 'enemy_spawn']) {
      expect(code(() => parse(fc(target, 1.01))), target).toBe('INVALID_INPUT:forecasts[0].value');
      expect(code(() => parse(fc(target, -0.01))), target).toBe('INVALID_INPUT:forecasts[0].value');
      expect(code(() => parse(fc(target, Number.NaN))), target).toBe('INVALID_INPUT:forecasts[0].value');
    }
    for (const target of ['egg_location', 'hyde_spawn_zone', 'EGG_SITE', '']) {
      expect(code(() => parse(fc(target, 0.5))), target).toBe('INVALID_INPUT:forecasts[0].target');
    }
    expect(code(() => parse(fc('egg_site', 0.5, { sites: { e_shed: 0.5 } })))).toBe('INVALID_INPUT:forecasts[0].features');
    expect(code(() => parse(fc('egg_site', 0.5, { site: 'x'.repeat(41) })))).toBe('INVALID_INPUT:forecasts[0].features');
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}`, i]));
    expect(code(() => parse(fc('egg_site', 0.5, many)))).toBe('INVALID_INPUT:forecasts[0].features');
    // in an append body each of these is dropped and counted, the events still go through
    const body = parseMysteryAppend({ sessionId: SID, events: [{ type: 'hint_requested', t: 30, seq: 4 }],
      forecasts: [fc('egg_site', 1.01), { ...fc('egg_location', 0.5), forecastNo: 1 }, { ...fc('hyde_zone', 0.4, { zone: 'z_mid' }), forecastNo: 2 }] });
    expect(body.events).toHaveLength(1);
    expect(body.forecasts.map((f) => f.target)).toEqual(['hyde_zone']);
    expect(body.dropped.forecasts).toBe(2);
  });
  it('every target the browser analytics can issue is accepted by this server (src/mystery/analytics/types.ts)', async () => {
    const client = await import('../../../src/mystery/analytics/types.ts') as { FORECAST_TARGETS?: readonly string[] };
    expect(client.FORECAST_TARGETS, 'the client exports FORECAST_TARGETS').toBeDefined();
    expect(client.FORECAST_TARGETS!.filter((t) => !(FORECAST_TARGETS as readonly string[]).includes(t))).toEqual([]);
  });
  it('every advice action the prescriptive engine can record is a valid recommendation action id', async () => {
    const p = await import('../../../src/mystery/analytics/prescriptive.ts') as { FOLLOW_WINDOW_S?: Record<string, number> };
    const actions = Object.keys(p.FOLLOW_WINDOW_S ?? {});
    expect(actions.length).toBeGreaterThan(5);
    expect(actions.filter((a) => !/^[a-z][a-z0-9_]{0,39}$/.test(a))).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------- case worlds + versions
describe('case worlds and case versions (server view)', () => {
  it('every content id the sim can put in a telemetry event matches SAFE_ID_RE', () => {
    const bad: string[] = [];
    const check = (where: string, id: string) => { if (!SAFE_ID_RE.test(id)) bad.push(`${where}: ${JSON.stringify(id)}`); };
    for (const caseId of CASE_IDS) {
      const w = CASE_WORLDS[caseId];
      expect(w, `CASE_WORLDS.${caseId}`).toBeDefined();
      expect(w.caseId).toBe(caseId);
      w.areas.forEach((a) => check(`${caseId} area`, a.id));
      w.zones.forEach((z) => check(`${caseId} zone`, z.id));
      w.clueSites.forEach((g) => g.sites.forEach((s) => check(`${caseId} clue site`, s.id)));
      w.eggSites.forEach((s) => check(`${caseId} egg site`, s.id));
      w.hydeSpawns.forEach((s) => check(`${caseId} spawn`, s.id));
      w.examines.forEach((x) => check(`${caseId} examine`, x.id));
      w.hazards.forEach((h) => check(`${caseId} hazard`, h.id));
      if (w.passage) check(`${caseId} passage`, w.passage.id);
      // trace sources are clue ids and examine ids
      requireData().cases[caseId].clues.forEach((c) => check(`${caseId} clue`, c.id));
    }
    expect(bad).toEqual([]);
  });
  it('the world covers exactly the case\'s three clues (the server validates clue ids against the CaseDef)', () => {
    for (const caseId of CASE_IDS) {
      expect(sorted(CASE_WORLDS[caseId].clueSites.map((g) => g.clueId))).toEqual(sorted(requireData().cases[caseId].clues.map((c) => c.id)));
    }
  });
  it('each case resolves at its deployed version (CaseDef.version == CaseSolution.version); any other version is CASE_OUTDATED', () => {
    const data = requireData();
    for (const caseId of CASE_IDS) {
      const v = data.cases[caseId].version;
      expect(v, `${caseId}: the overhaul bumped the case content version`).toBeGreaterThanOrEqual(2);
      for (const s of SUSPECT_IDS) expect(data.variants[caseId][s].solution.version, `${caseId}/${s}`).toBe(v);
      expect(resolveCase(caseId, v).caseDef.version).toBe(v);
      expect(code(() => resolveCase(caseId, v === 1 ? 2 : v - 1)), `${caseId} v${v}`).toBe('CASE_OUTDATED:');
    }
  });
});
