// Browser sim -> server contract. Plays real headless MysteryRun episodes (src/mystery, the code the kiosks run) for every
// case and both bot profiles, uploads EVERY event (no thinning: a superset of what the client sends) through the Edge
// Function's parser + rule reducer in append-sized batches, then recomputes the result like mystery-finalize and compares
// it with the browser's own RunResult. Any event type / enum / id the sim emits that the server would reject (which
// would stop the upload and leave the run "unverified" at the booth), any egg-tier / score / verdict drift, and any
// case-version mismatch between the sim's CaseDef and the server registry fails here.
// Run after `npm run sync:shared` (the server side uses the generated copies under supabase/functions/_shared).
import { describe, expect, it } from 'vitest';
import {
  MYSTERY_EVENT_TYPES, RULE_EVENT_TYPES, applyBatch, initialProgress, parseEventBatch, ruleFingerprint, type MysteryProgress,
} from '../../functions/_shared/mystery-events.ts';
import {
  PLAYER_MAX_HP, computeOffer, computeResult, requireData, requireEggRules, resolveCase, rulesContext,
} from '../../functions/_shared/mystery-rules.ts';
import { CASE_IDS } from '../../functions/_shared/mystery/types.ts';
import { scoreFor } from '../../functions/_shared/mystery/scoring.ts';
import type { GameEvent, StampedEvent } from '../../../src/mystery/types.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import type { BotProfile } from '../../../src/mystery/bot.ts';

const SEEDS_PER_CASE = 8;
const PROFILES: BotProfile[] = ['stealthy', 'careless'];
const BATCH = 200; // the client flushes ~100 events / 2 s; the server accepts ≤ 500

/** Deterministic 32-hex server-style seeds. */
const seedFor = (caseIdx: number, i: number) =>
  Array.from({ length: 4 }, (_, k) => (((caseIdx + 1) * 2654435761 + i * 40503 + k * 97) >>> 0).toString(16).padStart(8, '0')).join('');

describe('real sim episodes are accepted and re-verified by the server rules', () => {
  it('every case, both bot profiles, the duos the server itself offers', () => {
    const data = requireData();
    const egg = requireEggRules();
    const seen = new Set<string>();
    const outcomes: Record<string, number> = {};
    for (const [ci, caseId] of CASE_IDS.entries()) {
      const serverCase = data.cases[caseId];
      expect(CASES[caseId].version, `${caseId}: sim CaseDef version == server registry version`).toBe(serverCase.version);
      const kase = resolveCase(caseId, serverCase.version);
      for (let i = 0; i < SEEDS_PER_CASE; i++) {
        const seed = seedFor(ci, i);
        const duo = computeOffer(seed).cards[i % 3];
        const ctx = rulesContext(seed, kase.caseDef, egg);
        for (const profile of PROFILES) {
          const label = `${caseId} ${seed} ${profile} ${duo.characterId}+${duo.pokemonId}`;
          // careless bots use their F power / Q move (ability_used / ability_denied / lure + hazard noises in the stream)
          const ep = playEpisode({ characterId: duo.characterId, pokemonId: duo.pokemonId }, seed,
            { profile, useAbilities: profile === 'careless' }, { caseDef: CASES[caseId] });
          ep.events.forEach((e) => seen.add(e.type));
          // ---- upload (mystery-append-events): parse + reduce batch by batch, never mutating the stored state
          let p: MysteryProgress = initialProgress();
          let error: string | null = null;
          try {
            for (let k = 0; k < ep.events.length; k += BATCH) {
              p = applyBatch(p, parseEventBatch(ep.events.slice(k, k + BATCH), false), ctx);
            }
          } catch (e) {
            error = `${(e as Error).message} ${JSON.stringify((e as { details?: unknown }).details ?? {})}`;
          }
          expect(error, `${label}: upload rejected`).toBeNull();
          if (ep.timedOut || !ep.result) continue; // nothing to finalize (should not happen; counted below)
          // ---- finalize: replay the rule events only, recompute, compare with the browser's RunResult
          const ruleEvents = ep.events.filter((e) => (RULE_EVENT_TYPES as readonly string[]).includes(e.type));
          let replay = initialProgress();
          for (let k = 0; k < ruleEvents.length; k += BATCH) replay = applyBatch(replay, parseEventBatch(ruleEvents.slice(k, k + BATCH), false), ctx);
          expect(ruleFingerprint(replay), `${label}: finalize replay == append-time state`).toBe(ruleFingerprint(p));
          const client = ep.result as unknown as Record<string, unknown>;
          const server = computeResult(p, kase, ctx.expectedTier, client);
          expect(server.claimMatches, `${label}: server result == browser RunResult (${JSON.stringify({ server: [server.outcome, server.verdict, server.score], client: [ep.result.outcome, ep.result.verdict, ep.result.score] })})`).toBe(true);
          expect([server.outcome, server.verdict, server.score, server.caseVersion, server.eggTier])
            .toEqual([ep.result.outcome, ep.result.verdict, ep.result.score, ep.result.caseVersion, ep.result.eggTier]);
          outcomes[`${caseId}:${server.outcome}`] = (outcomes[`${caseId}:${server.outcome}`] ?? 0) + 1;
        }
      }
    }
    // every event type the sim emitted is a server type (implied by the parse above; kept explicit for the report)
    expect([...seen].filter((t) => !(MYSTERY_EVENT_TYPES as readonly string[]).includes(t))).toEqual([]);
    for (const caseId of CASE_IDS) expect(outcomes[`${caseId}:finished`] ?? 0, `${caseId}: some episodes finish`).toBeGreaterThan(0);
    const crackstone = [...seen].filter((t) => t.startsWith('crackstone_') || t === 'curse').sort();
    console.log(`sim contract: ${CASE_IDS.length * SEEDS_PER_CASE * PROFILES.length} episodes, outcomes ${JSON.stringify(outcomes)}, `
      + `event types seen: ${[...seen].sort().join(', ')}; Crackstone types seen: ${crackstone.join(', ') || 'none (sim does not emit them yet)'}`);
  }, 120_000);
});

// Hand-built, sim-shaped Crackstone stream, written against the sim's own GameEvent / StampedEvent types (the exact
// payload shapes of src/mystery/types.ts; the drift test in mystery-overhaul.test.ts pins them). Covers what the bots above do not emit yet: the four
// Crackstone telemetry types and `curse` (rule R7) — including a curse-caused hp_depleted DNF — through the same
// upload (parse + reduce in batches) and finalize (rule-event replay + computeResult) path.
describe('Crackstone + curse events through the server upload / finalize path (legacy v3.1 shape)', () => {
  const data = requireData();
  const egg = requireEggRules();
  const seed = seedFor(0, 99);

  function upload(events: StampedEvent[], ctx: ReturnType<typeof rulesContext>, batch = 5): MysteryProgress {
    let p = initialProgress();
    for (let k = 0; k < events.length; k += batch) p = applyBatch(p, parseEventBatch(events.slice(k, k + batch), false), ctx);
    const ruleEvents = events.filter((e) => (RULE_EVENT_TYPES as readonly string[]).includes(e.type));
    const replay = applyBatch(initialProgress(), parseEventBatch(ruleEvents, false), ctx);
    expect(ruleFingerprint(replay), 'finalize replay == append-time state').toBe(ruleFingerprint(p));
    return p;
  }

  /** An encounter: chase → curse cast → hit (or miss) → return, as ENEMY_CONTRACT sim rules 2–8 describe. */
  function encounter(out: StampedEvent[], t0: number, land: { hpLost: number; blocked: boolean } | null): void {
    let seq = out.length === 0 ? 0 : out[out.length - 1].seq + 1;
    const push = (e: GameEvent, t: number) => { out.push({ ...e, t, seq: seq++ } as StampedEvent); };
    push({ type: 'crackstone_scan', phase: 'warning', radiusM: 14, hit: false }, t0);
    push({ type: 'crackstone_scan', phase: 'pulse', radiusM: 14, hit: true }, t0 + 1.8);
    push({ type: 'crackstone_sighted', via: 'scan', distanceM: 11.2 }, t0 + 1.8);
    push({ type: 'crackstone_mode', from: 'PATROL', to: 'CHASE', reason: 'scan_hit' }, t0 + 1.8);
    push({ type: 'crackstone_mode', from: 'CHASE', to: 'ATTACK', reason: 'curse_cast' }, t0 + 4);
    push({ type: 'curse', phase: 'cast', hpLost: 0, blocked: false }, t0 + 4);
    if (land) {
      push({ type: 'curse', phase: 'hit', hpLost: land.hpLost, blocked: land.blocked }, t0 + 5.2);
      push({ type: 'crackstone_mode', from: 'ATTACK', to: 'RETURN', reason: 'curse_done' }, t0 + 5.2);
    } else {
      push({ type: 'curse', phase: 'miss', hpLost: 0, blocked: false }, t0 + 5.2);
      push({ type: 'crackstone_mode', from: 'ATTACK', to: 'SEARCH', reason: 'curse_missed' }, t0 + 5.2);
      push({ type: 'crackstone_lost' }, t0 + 6);
    }
    push({ type: 'crackstone_mode', from: 'RETURN', to: 'PATROL', reason: 'returned' }, t0 + 15);
  }

  it('every case: a cursed run finishes verified, and a run that dies to curses is a verified hp_depleted DNF', () => {
    for (const caseId of CASE_IDS) {
      const kase = resolveCase(caseId, data.cases[caseId].version);
      // legacy v3.1 stream shape (curse without enemy_hit); the v4 shape is covered by mystery-v4.test.ts
      const ctx = rulesContext(seed, kase.caseDef, egg, PLAYER_MAX_HP, 'mystery-v3.1');
      const tier = ctx.expectedTier!;
      const curseHp = 25;
      // ---- finished: one hit, one blocked hit, one miss; clues, egg, accusation
      const fin: StampedEvent[] = [];
      encounter(fin, 5, { hpLost: curseHp, blocked: false });
      encounter(fin, 25, { hpLost: 0, blocked: true });
      encounter(fin, 45, null);
      let seq = fin[fin.length - 1].seq + 1;
      let t = 70;
      const push = (e: GameEvent) => { fin.push({ ...e, t: (t += 2), seq: seq++ } as StampedEvent); };
      kase.caseDef.clues.forEach((c, i) => push({ type: 'clue_found', clueId: c.id, cluesFound: i + 1 }));
      push({ type: 'egg_pickup' });
      push({ type: 'egg_delivered', tier, points: egg.points[tier], security: 100 });
      const at = t;
      fin.push({ type: 'accusation', suspectId: kase.solution.culprit, correct: true, cluesFound: 3,
        evidence: [...kase.solution.supportingEvidence], deductionCorrect: true, t: at, seq: seq++ } as StampedEvent);
      fin.push({ type: 'finish', verdict: 'case_solved', score: scoreFor(egg.points[tier], at), t: at, seq: seq++ } as StampedEvent);
      const p = upload(fin, ctx);
      expect([p.curses, p.hpLost, p.catches, p.sightings], caseId).toEqual([2, curseHp, 0, 0]);
      expect(computeResult(p, kase, tier, undefined, 'mystery-v3.1'), caseId).toMatchObject({ outcome: 'finished', verdict: 'case_solved', catches: 0, claimMatches: true });
      // ---- dnf: four landed curses of 25 HP (100 = max HP), the dnf emitted right after the last hit
      const dead: StampedEvent[] = [];
      for (let i = 0; i < 4; i++) encounter(dead, 5 + i * 20, { hpLost: curseHp, blocked: false });
      const last = [...dead].reverse().find((e) => e.type === 'curse' && e.phase === 'hit')!;
      const cut = dead.indexOf(last) + 1; // the run ends at the hit: nothing after it but the dnf
      const dnfStream = [...dead.slice(0, cut), { type: 'dnf', reason: 'hp_depleted', t: last.t, seq: last.seq + 1 } as StampedEvent];
      const q = upload(dnfStream, ctx);
      expect([q.curses, q.hpLost, q.catches, q.terminal?.type], caseId).toEqual([4, 4 * curseHp, 0, 'dnf']);
      expect(computeResult(q, kase, tier, { outcome: 'dnf', dnfReason: 'hp_depleted', score: null, caseId }, 'mystery-v3.1'), caseId)
        .toMatchObject({ outcome: 'dnf', dnfReason: 'hp_depleted', score: null, catches: 0, claimMatches: true });
    }
  });
});
