// Final HUD (docs/final/UX_FINAL.md) — frontend A view-models: threat chips (incl. director states), Odds v3 (facts as
// words, no 0 / 100 %, Away / Next: area from the director distribution, footer by source), the danger-view lens (cycle,
// auto pick, 4 s hysteresis), Principal Weems (note → hint, no-charge refusals, levels), cabinet prompt states, the death
// sequence (once, skip rules, minimum length, countdown) and the Tally. Plus static renders of the new components.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LiveForecasts } from '../../../src/mystery/analytics/types.ts';
import type { StampedEvent } from '../../../src/mystery/types.ts';
import {
  autoLensNow, directorChip, enemyLife, fmtClock, hydeChip, huntedBy, KeyHold, LENS_HOLD_S, LensPicker, lensLabel, lensSuffix, nextLens, orderChips,
  SLURP_THREAT, slurpChip, slurpChipKey, slurpMarkerKind, type EnemyLife,
} from '../../../src/app/mystery/hud/enemies.ts';
import { buildOddsV3, oddsFooter, OddsBandHold, oddsV3Phase, spawnAreas, type OddsV3In } from '../../../src/app/mystery/hud/oddsV3.ts';
import { cabinetStatusOf, CabinetTracker, cabinetView, CABINET_NONE, type CabinetIn } from '../../../src/app/mystery/hud/cabinet.ts';
import { hintCard, noteCard, WEEMS_COPY, WeemsController, weemsSimOf, type WeemsContext } from '../../../src/app/mystery/hud/weems.ts';
import { DEATH_CARD_S, DEATH_FLAVOUR, deathKicker, deathTally, deathWhy, defeatedBy, DeathSequence } from '../../../src/app/mystery/hud/death.ts';
import { TallyTracker } from '../../../src/app/mystery/hud/tally.ts';
import { ThreatsStrip } from '../../../src/ui/mystery/hud/ThreatsStrip.tsx';
import { OddsPanel } from '../../../src/ui/mystery/hud/OddsPanel.tsx';
import { CabinetBlock } from '../../../src/ui/mystery/hud/CabinetHud.tsx';
import { AskWeemsButton, WeemsCard } from '../../../src/ui/mystery/hud/Weems.tsx';
import { DeathOverlay } from '../../../src/ui/mystery/hud/DeathOverlay.tsx';
import { AnalyticsLegend } from '../../../src/ui/mystery/hud/AnalyticsLegend.tsx';
import { LensBar } from '../../../src/ui/mystery/hud/LensBar.tsx';
import { lensLayers } from '../../../src/ui/mystery/hud/Minimap.tsx';

const life = (enemy: EnemyLife['enemy'], o: Partial<EnemyLife> = {}): EnemyLife => ({ enemy, present: true, active: true, phase: 'active', arrivesInS: null, everActive: true, ...o });
let seq = 0;
const ev = (e: Record<string, unknown>): StampedEvent => ({ t: 0, seq: ++seq, ...e }) as unknown as StampedEvent;

// ------------------------------------------------------------------------------------------------- threats strip

describe('threats strip (§1a)', () => {
  it('Slurp words + icons exactly as §8, CHASE / ATTACK first, then SEES YOU', () => {
    expect(Object.values(SLURP_THREAT).map((t) => t.word)).toEqual(['Wandering', 'SEES YOU', 'Heard something', 'Searching', 'CHASING YOU', 'GRABBING', 'Wandering off']);
    expect(slurpChipKey({ mode: 'WANDER', canSeePlayer: false, attacking: false })).toBe('WANDER');
    expect(slurpChipKey({ mode: 'WANDER', canSeePlayer: true, attacking: false })).toBe('SEES');
    expect(slurpChipKey({ mode: 'CHASE', canSeePlayer: true, attacking: false })).toBe('CHASE');
    expect(slurpChipKey({ mode: 'CHASE', canSeePlayer: true, attacking: true })).toBe('ATTACK');
    expect(slurpChipKey({ mode: 'LEAVE', canSeePlayer: false, attacking: false })).toBe('LEAVE');
    expect(slurpChip('ATTACK', 1, null)).toMatchObject({ word: 'GRABBING', icon: 'slurp', assertive: true, kicker: 'SLURP' });
    expect(slurpChip('WANDER', 0.2, null).assertive).toBe(false);
  });

  it('director states: "Arrives in m:ss" / "Arriving soon" before a spawn, "Away" after a despawn, none while active', () => {
    expect(directorChip(life('slurp', { active: false, phase: 'inactive', arrivesInS: 19.2, everActive: false }))).toMatchObject({ word: 'Arrives in 0:20', director: 'arrives', meter: null, state: 'ARRIVES' });
    expect(directorChip(life('slurp', { active: false, phase: 'inactive', arrivesInS: 0, everActive: false }))?.word).toBe('Arriving soon');
    expect(directorChip(life('slurp', { active: false, phase: 'inactive', arrivesInS: null, everActive: false }))?.word).toBe('Arriving soon');
    expect(directorChip(life('hyde', { active: false, phase: 'cooldown', arrivesInS: 12 }))).toMatchObject({ word: 'Away', director: 'away', icon: 'reset' });
    expect(directorChip(life('hyde'))).toBeNull();
    expect(directorChip(life('crackstone', { present: false, active: false }))).toBeNull();
    expect(fmtClock(65.2)).toBe('1:06');
  });

  it('fixed order Hyde · Crackstone · Slurp, absent omitted; hunted = an engaged chip (never a director chip)', () => {
    const chips = orderChips([slurpChip('CHASE', 1, null), null, hydeChip('PATROL', 0.1, null)]);
    expect(chips.map((c) => c.enemy)).toEqual(['hyde', 'slurp']);
    expect(huntedBy(chips)).toBe('slurp');
    expect(huntedBy([hydeChip('SEARCH', 0.5, null)])).toBeNull();
    expect(hydeChip('CHASE', 1, null)).toMatchObject({ word: 'CHASING YOU', assertive: true });
  });

  it('KeyHold: 0.5 s hold, CHASE / ATTACK bypass', () => {
    const k = new KeyHold<'WANDER' | 'SEES' | 'CHASE'>('WANDER', 0.5, ['CHASE']);
    expect(k.update('SEES', 0)).toBe('SEES');
    expect(k.update('WANDER', 0.2)).toBe('SEES');
    expect(k.update('WANDER', 0.6)).toBe('WANDER');
    expect(k.update('CHASE', 0.65)).toBe('CHASE');
  });

  it('enemyLife reads run.enemyStatus() (record), the director view, else the legacy emergence', () => {
    const run = {
      t: 10, status: 'playing',
      enemyStatus: () => ({
        hyde: { present: true, active: false, phase: 'cooldown', mode: 'PATROL', arrivesInS: null, engaged: false },
        crackstone: { present: true, active: true, phase: 'active', mode: 'PATROL', arrivesInS: null, engaged: false },
        slurp: { present: true, active: false, phase: 'inactive', mode: 'WANDER', arrivesInS: 31, engaged: false },
      }),
    };
    const L = { emerged: true, emergesInS: null };
    expect(enemyLife(run, 'hyde', L)).toMatchObject({ phase: 'cooldown', active: false });
    expect(directorChip(enemyLife(run, 'hyde', L))?.word).toBe('Away');
    expect(directorChip(enemyLife(run, 'slurp', L))?.word).toBe('Arrives in 0:31');
    expect(enemyLife(run, 'crackstone', L).active).toBe(true);
    const legacy = { t: 5, status: 'playing', hydeBrain: { active: true } };
    expect(enemyLife(legacy, 'hyde', { emerged: false, emergesInS: 15 })).toMatchObject({ active: false, phase: 'inactive', arrivesInS: 15 });
    expect(enemyLife(legacy, 'slurp', { emerged: false, emergesInS: 15 }).present).toBe(false);
    const dir = { t: 40, status: 'playing', slurp: { mode: 'WANDER', active: false }, director: { view: () => ({ phase: 'cooldown', managed: true, nextSpawnInS: 8, spawnedAt: 12 }) } };
    expect(enemyLife(dir, 'slurp', { emerged: true, emergesInS: null })).toMatchObject({ phase: 'cooldown', active: false, everActive: true });
  });

  it('R4 for Slurp: position only while visible / chasing / attacking / revealed', () => {
    const base = { active: true, mode: 'WANDER', attacking: false, x: 10, z: 0 };
    const fx = { enemiesRevealed: false, enemyRevealRangeM: 0 };
    expect(slurpMarkerKind({ slurp: base, slurpVisible: () => false }, fx, { x: 0, z: 0 })).toBeNull();
    expect(slurpMarkerKind({ slurp: base, slurpVisible: () => true }, fx, { x: 0, z: 0 })).toBe('visible');
    expect(slurpMarkerKind({ slurp: { ...base, mode: 'CHASE' } }, fx, { x: 0, z: 0 })).toBe('chase');
    expect(slurpMarkerKind({ slurp: { ...base, attacking: true } }, fx, { x: 0, z: 0 })).toBe('attack');
    expect(slurpMarkerKind({ slurp: base }, { enemiesRevealed: true, enemyRevealRangeM: 5 }, { x: 0, z: 0 })).toBeNull();
    expect(slurpMarkerKind({ slurp: base }, { enemiesRevealed: true, enemyRevealRangeM: 15 }, { x: 0, z: 0 })).toBe('revealed');
    expect(slurpMarkerKind({ slurp: { ...base, active: false, mode: 'CHASE' } }, fx, { x: 0, z: 0 })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------- Odds v3

function forecasts(o: Partial<LiveForecasts> & { slurp?: unknown } = {}): LiveForecasts {
  return {
    detection: null,
    extraction: { p: 0.62, source: 'rule', label: 'Rule-based estimate' },
    egg: null,
    clueAreas: { areas: [{ areaId: 'a1', name: 'Maintenance Tunnel', x: 0, z: 0, radiusM: 8, p: 0.55 }, { areaId: 'a2', name: 'Chapel', x: 0, z: 0, radiusM: 8, p: 0.2 }], label: 'Bayesian estimate' },
    hyde: { phase: 'active', zones: [], label: 'Bayesian estimate' },
    crackstone: { cells: [], here: { p: 0.02, fact: null }, horizonS: 10, label: 'Rule-based estimate', area: { name: 'Stacks', polygon: [] } },
    ...o,
  } as LiveForecasts;
}

const oddsIn = (o: Partial<OddsV3In> = {}): OddsV3In => ({
  phase: 'find_clues',
  forecasts: forecasts({ slurp: { cells: [], here: { p: 0.1, fact: null }, horizonS: 15, label: 'Rule-based estimate', mode: 'WANDER' } }),
  investigation: null,
  deltas: new Map(),
  doorClosed: false,
  monsters: {
    hyde: { life: life('hyde'), risk: { p: 0.2, band: 'low', label: 'ML estimate', detectedNow: false }, hunting: false, seesYou: false },
    crackstone: { life: life('crackstone'), hunting: false, seesYou: false },
    slurp: { life: life('slurp'), hunting: false, seesYou: false },
  },
  ...o,
});

describe('Odds panel v3 (§1c)', () => {
  it('one line per monster (fixed order) + the objective row; labels, <5%, bands; no 0 / 100 %', () => {
    const v = buildOddsV3(oddsIn());
    expect(v.rows.map((r) => `${r.id}|${r.label}|${r.cell?.text}|${r.cell?.band}`)).toEqual([
      'hyde|Hears you|20%|unlikely', 'crackstone|Sees you|<5%|unlikely', 'slurp|Finds you|10%|unlikely', 'objective|Maintenance Tunnel|55%|maybe',
    ]);
    expect(v.rows[3]!.tag).toBe('CLUE');
    for (const r of v.rows) expect(r.cell?.text).not.toMatch(/^(0|100)%$/);
    const hi = buildOddsV3(oddsIn({ monsters: { hyde: { life: life('hyde'), risk: { p: 0.999, band: 'high', label: 'ML estimate', detectedNow: false }, hunting: false, seesYou: false } } }));
    expect(hi.rows[0]!.cell?.text).toBe('>95%');
  });

  it('facts are words: Hunting you (full bar), Seen now, Hidden (door closed, empty bar) — never for the Hyde row Hidden', () => {
    const v = buildOddsV3(oddsIn({
      doorClosed: false,
      monsters: {
        hyde: { life: life('hyde'), risk: { p: 0.9, band: 'high', label: 'ML estimate', detectedNow: false }, hunting: true, seesYou: true },
        crackstone: { life: life('crackstone'), hunting: false, seesYou: true },
        slurp: { life: life('slurp'), hunting: false, seesYou: false },
      },
    }));
    expect(v.rows[0]).toMatchObject({ kind: 'fact', bar: 100, source: null });
    expect(v.rows[0]!.cell?.text).toBe('Hunting you');
    expect(v.rows[1]!.cell?.text).toBe('Seen now');
    const closed = buildOddsV3(oddsIn({ doorClosed: true }));
    expect(closed.rows.map((r) => r.cell?.text).slice(0, 3)).toEqual(['20%', 'Hidden', 'Hidden']);
    expect(closed.rows[1]!.bar).toBe(0);
    const viaForecast = buildOddsV3(oddsIn({ forecasts: forecasts({ crackstone: { cells: [], here: { p: 0.8, fact: 'hunting' }, horizonS: 10, label: 'Rule-based estimate', area: { name: 'x', polygon: [] } } }) }));
    expect(viaForecast.rows.find((r) => r.id === 'crackstone')?.cell?.text).toBe('Hunting you');
  });

  it('Away while the cooldown runs (muted, no bar); "Next: {area}" = the director distribution grouped by area', () => {
    const f = forecasts({
      threat: {
        zones: [], ownZoneId: null, here: { max: 0, top: null }, label: 'x',
        enemies: {
          slurp: {
            enemy: 'slurp', name: 'Slurp', state: 'inactive', basis: 'spawn_rules', label: 'Rule-based estimate · spawn rules', meaning: 'appear', zones: [], mode: null, appearsInS: 0, here: null,
            spawns: [
              { spawnId: 's1', name: 'Chapel', zoneId: 'z', x: 0, z: 0, p: 0.3 }, { spawnId: 's2', name: 'Crypt Stair', zoneId: 'z', x: 0, z: 0, p: 0.25 },
              { spawnId: 's3', name: 'Chapel', zoneId: 'z', x: 0, z: 0, p: 0.2 }, { spawnId: 's4', name: 'Yard', zoneId: 'z', x: 0, z: 0, p: 0.25 },
            ],
          },
        },
      },
    });
    expect(spawnAreas(f.threat!.enemies.slurp!.spawns!).map((a) => `${a.name}:${a.p.toFixed(2)}`)).toEqual(['Chapel:0.50', 'Crypt Stair:0.25', 'Yard:0.25']);
    const next = buildOddsV3(oddsIn({ forecasts: f, monsters: { slurp: { life: life('slurp', { active: false, phase: 'inactive', everActive: false, arrivesInS: 5 }), hunting: false, seesYou: false } } }));
    expect(next.rows[0]).toMatchObject({ id: 'slurp', label: 'Next: Chapel', kind: 'next', source: 'Rule-based estimate' });
    expect(next.rows[0]!.cell?.text).toBe('50%');
    const away = buildOddsV3(oddsIn({ forecasts: f, monsters: { slurp: { life: life('slurp', { active: false, phase: 'cooldown', arrivesInS: 9 }), hunting: false, seesYou: false } } }));
    expect(away.rows[0]).toMatchObject({ label: 'Away', kind: 'away', cell: null, bar: 0 });
    const over = buildOddsV3(oddsIn({ forecasts: f, monsters: { slurp: { life: life('slurp', { active: false, phase: 'cooldown', arrivesInS: 0 }), hunting: false, seesYou: false } } }));
    expect(over.rows[0]!.label).toBe('Next: Chapel'); // cooldown over → may appear next
  });

  it('never invented: a monster without a number gets no row; tutorial / accuse hide the panel', () => {
    const v = buildOddsV3(oddsIn({ forecasts: forecasts({ crackstone: null }), monsters: { crackstone: { life: life('crackstone'), hunting: false, seesYou: false } } }));
    expect(v.rows.map((r) => r.id)).toEqual(['objective']);
    expect(oddsV3Phase('tutorial', 'find_clues', forecasts())).toBe('hidden');
    expect(oddsV3Phase('playing', 'accuse', forecasts())).toBe('hidden');
    expect(oddsV3Phase('playing', 'deliver_egg', forecasts())).toBe('carry');
    expect(buildOddsV3(oddsIn({ phase: 'carry' })).rows.at(-1)).toMatchObject({ tag: 'TOWER', label: 'Reach the tower' });
  });

  it('footer groups exact sources (first-fit, the spec layout)', () => {
    const v = buildOddsV3(oddsIn());
    expect(v.footer).toEqual(['Hyde: ML estimate · Clue: Bayesian estimate', 'Crackstone, Slurp: Rule-based estimate']);
    expect(oddsFooter([])).toEqual([]);
  });

  it('band hold: a monster band changes at most every 2 s; facts switch at once', () => {
    const hold = new OddsBandHold();
    const at = (p: number) => buildOddsV3(oddsIn({ monsters: { hyde: { life: life('hyde'), risk: { p, band: 'low', label: 'ML estimate', detectedNow: false }, hunting: false, seesYou: false } } }));
    expect(hold.apply(at(0.2), 0).rows[0]!.cell?.band).toBe('unlikely');
    expect(hold.apply(at(0.5), 1).rows[0]!.cell?.band).toBe('unlikely');
    expect(hold.apply(at(0.5), 0.5 + 2).rows[0]!.cell?.band).toBe('maybe');
  });
});

// ------------------------------------------------------------------------------------------------- lens

describe('danger-view lens (§1d)', () => {
  it('X cycles Auto → Hyde → Crackstone → Slurp → Auto, skipping absent monsters', () => {
    const all = ['hyde', 'crackstone', 'slurp'] as const;
    expect([nextLens('auto', all), nextLens('hyde', all), nextLens('crackstone', all), nextLens('slurp', all)]).toEqual(['hyde', 'crackstone', 'slurp', 'auto']);
    expect(nextLens('hyde', ['hyde', 'slurp'])).toBe('slurp');
  });

  it('auto pick: engaged > active with the highest Odds p > Hyde', () => {
    const base = { present: ['hyde', 'crackstone', 'slurp'] as const, active: ['hyde', 'crackstone', 'slurp'] as const };
    expect(autoLensNow({ ...base, engaged: ['slurp'], oddsP: { hyde: 0.9 } })).toBe('slurp');
    expect(autoLensNow({ ...base, engaged: [], oddsP: { hyde: 0.1, crackstone: 0.4, slurp: 0.2 } })).toBe('crackstone');
    expect(autoLensNow({ ...base, active: [], engaged: [], oddsP: {} })).toBe('hyde');
  });

  it('4 s hysteresis; an engaged (urgent) monster takes over at once; a manual choice sticks', () => {
    const lp = new LensPicker();
    const i = (oddsP: Record<string, number>) => ({ present: ['hyde', 'crackstone', 'slurp'] as const, active: ['hyde', 'crackstone', 'slurp'] as const, engaged: [] as const, oddsP });
    expect(lp.update(i({ hyde: 0.5, crackstone: 0.1 }), 0).enemy).toBe('hyde');
    expect(lp.update(i({ hyde: 0.1, crackstone: 0.5 }), 1).enemy).toBe('hyde');
    expect(lp.update(i({ hyde: 0.1, crackstone: 0.5 }), LENS_HOLD_S + 0.1).enemy).toBe('crackstone');
    expect(lp.update(i({ hyde: 0.1, crackstone: 0.5 }), LENS_HOLD_S + 0.5, 'slurp').enemy).toBe('slurp');
    lp.cycle(['hyde', 'crackstone', 'slurp']);
    expect(lp.update(i({ crackstone: 0.9 }), 10)).toEqual({ enemy: 'hyde', auto: false });
  });

  it('labels (§8) and the ONE minimap layer per lens', () => {
    expect(lensLabel('hyde', true, false)).toBe('Hyde odds · auto');
    expect(lensLabel('crackstone', false, false)).toBe('Crackstone sight');
    expect(lensLabel('slurp', true, true)).toBe('Slurp odds · auto · may appear');
    expect(lensSuffix(false, true)).toBe('may appear');
    expect(lensLayers({ enemy: 'slurp', inactive: false })).toEqual({ zones: false, egg: true, clues: true, crack: true, crackRisk: false, slurp: true, pins: [] });
    expect(lensLayers({ enemy: 'crackstone', inactive: true })).toMatchObject({ zones: false, crackRisk: false, slurp: false, pins: ['crackstone'] });
    expect(lensLayers(null)).toEqual({ zones: true, egg: true, clues: true, crack: true });
  });
});

// ------------------------------------------------------------------------------------------------- Weems

describe('Principal Weems (§4): paid, optional, never charged on a refusal', () => {
  const ctx = (o: Partial<WeemsContext> = {}): WeemsContext => ({ tutorial: false, playing: true, hunted: false, sim: { cooldownLeftS: 0, used: 0, available: true, reason: 'ready', level: 1 }, ...o });

  it('first press of the run = the note (no charge), afterwards every ready press = a hint', () => {
    const w = new WeemsController();
    expect(w.press(0, ctx())).toBe('note');
    expect(w.noteShowing(3)).toBe(true);
    expect(w.press(2, ctx())).toBe('hint');
    expect(w.press(30, ctx())).toBe('hint');
    expect(noteCard(1).lines).toEqual(['My hints cost 50 points each.', 'Press V again to ask.', 'Thing’s tips stay free.']);
  });

  it('cooldown / hunted / exhausted / tutorial are no-ops (no hint reaches the sim)', () => {
    const w = new WeemsController();
    w.press(0, ctx());
    expect(w.press(1, ctx({ sim: { cooldownLeftS: 12, used: 1, available: false, reason: 'cooldown', level: 2 } }))).toBeNull();
    expect(w.button(ctx({ sim: { cooldownLeftS: 12, used: 1, available: false, reason: 'cooldown', level: 2 } }), 1)).toMatchObject({ state: 'cooldown', sub: 'Ready in 12 s' });
    expect(w.press(1, ctx({ hunted: true }))).toBeNull();
    expect(w.button(ctx({ hunted: true }), 1).sub).toBe('Not while hunted');
    expect(w.press(1, ctx({ sim: { cooldownLeftS: 0, used: 0, available: false, reason: 'hunted', level: 1 } }))).toBeNull();
    const ex = ctx({ sim: { cooldownLeftS: 0, used: 3, available: false, reason: 'exhausted', level: null } });
    expect(w.press(1, ex)).toBeNull();
    expect(w.button(ex, 3)).toMatchObject({ state: 'exhausted', sub: 'No more hints here', disabled: true });
    expect(w.press(1, ctx({ tutorial: true }))).toBeNull();
    expect(w.button(ctx({ tutorial: true }), 0).state).toBe('hidden');
    expect(w.button(ctx(), 2).sub).toBe('−50 · used 2');
  });

  it('levels: event level → sim level → local ladder (resets on progress, exhausted after L3 without a sim)', () => {
    const w = new WeemsController();
    expect(w.onHintEvent(ev({ type: 'hint_requested', level: 2 }) as never, null)).toBe(2);
    const local = new WeemsController();
    expect(local.onHintEvent(ev({ type: 'hint_requested' }) as never, null)).toBe(1);
    expect(local.onHintEvent(ev({ type: 'hint_requested' }) as never, null)).toBe(2);
    expect(local.onHintEvent(ev({ type: 'hint_requested' }) as never, null)).toBe(3);
    expect(local.exhausted({ tutorial: false, playing: true, hunted: false, sim: null })).toBe(true);
    local.progress();
    expect(local.nextLevel(null)).toBe(1);
    expect(local.used).toBe(3);
  });

  it('reads run.weemsStatus() (final sim) and the overhaul hintReadyAt fallback', () => {
    expect(weemsSimOf({ weemsStatus: () => ({ cooldownLeftS: 4, used: 2, available: false, reason: 'cooldown', nextLevel: 3 }) })).toEqual({ cooldownLeftS: 4, used: 2, available: false, reason: 'cooldown', level: 3 });
    expect(weemsSimOf({ hintReadyAt: 20, t: 15 })).toMatchObject({ cooldownLeftS: 5 });
    expect(weemsSimOf({})).toBeNull();
  });

  it('hint card copy: kicker, ≤ 90 chars, footer, map mark', () => {
    const c = hintCard(1, 2, 'x'.repeat(120), 3, true);
    expect(c.kicker).toBe('PRINCIPAL WEEMS · HINT 2 OF 3');
    expect(c.lines[0]!.length).toBeLessThanOrEqual(90);
    expect(c.footer).toBe('−50 points · 3 hints used');
    const html = renderToStaticMarkup(createElement(WeemsCard, { c }));
    expect(html).toContain(WEEMS_COPY.marked);
    expect(html).not.toContain('thing-sigil'); // never Thing's sigil on a Weems card
  });
});

// ------------------------------------------------------------------------------------------------- cabinets

describe('cabinet prompt states (§2)', () => {
  const v = (o: Partial<CabinetIn>) => cabinetView({ ...CABINET_NONE, ...o });
  it('outside: [E] Hide (+ amber warning when watched); nothing out of range', () => {
    expect(v({}).prompt).toBeNull();
    expect(v({ inRange: true }).prompt).toMatchObject({ kind: 'hide', warn: null });
    expect(v({ inRange: true, watchedBy: 'slurp' }).prompt?.warn).toBe('It can see you. It will check this cabinet.');
  });
  it('entering / exiting: no prompt; closing: "Closing…" only', () => {
    expect(v({ phase: 'entering' })).toMatchObject({ prompt: null, chip: null, inside: true });
    expect(v({ phase: 'exiting' }).prompt).toBeNull();
    expect(v({ phase: 'closing' })).toMatchObject({ prompt: null, chip: { text: 'Closing…' } });
  });
  it('door open / closed chips + prompts; creak soon; right outside; witnessed (lantern exit)', () => {
    expect(v({ phase: 'open' })).toMatchObject({ door: 'open', vitals: 'IN CABINET · door open', chip: { text: 'DOOR OPEN · you can be spotted' }, prompt: { kind: 'close', aside: 'Move to step out' } });
    expect(v({ phase: 'closed' })).toMatchObject({ door: 'closed', vitals: 'IN CABINET · door closed', chip: { text: 'DOOR CLOSED · hidden from sight' }, prompt: { kind: 'exit', quiet: true, urgent: false } });
    expect(v({ phase: 'closed', creakInS: 4 }).chip?.line2).toBe('The door will creak soon.');
    expect(v({ phase: 'closed', creakInS: 9 }).chip?.line2).toBeNull();
    expect(v({ phase: 'closed', outside: 'crackstone', creakInS: 2 }).chip?.line2).toBe('Crackstone is right outside. Wait.');
    const w = v({ phase: 'closed', witnessedBy: 'slurp', outside: 'hyde' });
    expect(w.chip).toMatchObject({ line2: 'Slurp saw you hide! Get out now.', witnessedBy: 'slurp' });
    expect(w.prompt?.urgent).toBe(true);
    const html = renderToStaticMarkup(createElement(CabinetBlock, { v: v({ phase: 'closed' }) }));
    expect(html).toContain('Stay quiet');
    expect(html).toContain('>Exit<');
  });
  it('sim adapter + event tracker: witnessed_hide, creaks from lastCreakAt, pull-out tint', () => {
    const st = cabinetStatusOf({ cabinetStatus: () => ({ spotId: 'c1', phase: 'open', closing: true, witnessedBy: null, creakInS: 7, lastCreakAt: null, enemyOutside: { enemy: 'slurp', visible: false } }) });
    expect(st).toMatchObject({ phase: 'closing', witnessedBy: null, creakInS: 7, outside: null, spotId: 'c1' });
    expect(cabinetStatusOf({ cabinetStatus: () => null })).toBeNull();
    const t = new CabinetTracker();
    t.update([ev({ type: 'enemy_detected', enemy: 'hyde', via: 'witnessed_hide' })], 'open', 1, 1, null);
    expect(t.witnessedBy).toBe('hyde');
    expect(t.update([], 'closed', 2, 2, 1.9).creak).toBe(true);
    expect(t.update([], 'closed', 2.1, 2.1, 1.9).creak).toBe(false);
    expect(t.update([ev({ type: 'cabinet', spotId: 'c1', action: 'pulled_out', loud: false })], null, 3, 3, null).pulledOut).toBe('hyde');
  });
});

// ------------------------------------------------------------------------------------------------- death

describe('death sequence (§3): once, skip rules, minimum length, card countdown', () => {
  it('triggers once; Skip only from t0 + 0.5 s and only for keydowns that started after t0', () => {
    const d = new DeathSequence();
    expect(d.start('slurp', 1000, { reduced: false, rendered: false, keyT0: 50_000 })).toBe(true);
    expect(d.start('hyde', 1100, { reduced: false, rendered: false })).toBe(false);
    expect(d.skipVisible(1300)).toBe(false);
    expect(d.skip(1300, { startedAt: 50_100 })).toBe(false); // too early
    expect(d.skip(1600, { startedAt: 49_900 })).toBe(false); // the key went down before t0
    expect(d.skip(1600, { startedAt: 50_300, repeat: true })).toBe(false); // auto-repeat
    expect(d.skipVisible(1600)).toBe(true);
    expect(d.skip(1600, { startedAt: 50_600 })).toBe(true);
    expect(d.state).toMatchObject({ phase: 'card', skipped: true, enemy: 'slurp' });
    expect(d.skip(1700, { startedAt: 0, click: true })).toBe(false);
  });

  it('stand-in length per monster, renderer minimum, reduced ≤ 1.5 s; 12 s countdown → continue once', () => {
    const d = new DeathSequence();
    d.start('crackstone', 0, { reduced: false, rendered: false });
    d.tick(3900);
    expect(d.state?.phase).toBe('cutscene');
    d.tick(4000);
    expect(d.state?.phase).toBe('card');
    expect(d.countdownS(4000)).toBe(DEATH_CARD_S);
    expect(d.countdownS(4000 + 5200)).toBe(7);
    expect(d.tick(4000 + 12_000)).toBe('continue');
    expect(d.continue()).toBe(false);
    const r = new DeathSequence();
    r.start('slurp', 0, { reduced: true, rendered: true });
    r.cutsceneDone(900); // the renderer finished early: the 1.2 s still is kept
    expect(r.state?.phase).toBe('cutscene');
    r.tick(1200);
    expect(r.state).toMatchObject({ phase: 'card', cardAfterMs: 1200 }); // + the 300 ms crossfade = 1.5 s
    const s = new DeathSequence();
    s.start('hyde', 0, { reduced: false, rendered: true });
    s.cutsceneDone(3300);
    expect(s.state?.phase).toBe('card');
    expect(s.continue()).toBe(true);
    expect(s.continue()).toBe(false);
  });

  it('card copy (§8): kicker, flavour, tally, WHY ≤ 52 chars, defeatedBy fallback', () => {
    expect(deathKicker('02')).toBe('RUN OVER · CASE 02');
    expect(DEATH_FLAVOUR.slurp).toBe('Slurp lurched out of the dark and grabbed you.');
    expect(deathTally(134.6, 2, 3, 3)).toBe('2:14 played · 2/3 clues · 3 hits');
    expect(deathWhy({ reason: 'hp_depleted', enemy: 'slurp', hits: 3, lastWhy: 'Slurp saw you and gave chase.' })).toEqual(['Your HP ran out after 3 hits.', 'Slurp saw you and gave chase.']);
    expect(deathWhy({ reason: 'second_catch', enemy: 'hyde', hits: 2, lastWhy: 'x'.repeat(80) })[1]!.length).toBeLessThanOrEqual(52);
    expect(defeatedBy(null, 'crackstone')).toBe('crackstone');
    expect(defeatedBy(undefined, null)).toBe('hyde');
  });

  it('overlay: letterbox + caption + Skip; card with medallion, "Defeated by", WHY, tally, See results, countdown', () => {
    const cut = renderToStaticMarkup(createElement(DeathOverlay, { d: { phase: 'cutscene', enemy: 'slurp', reduced: false, skip: true, caption: '[Slurp groans and grabs]', card: null }, onSkip: () => {}, onContinue: () => {} }));
    expect(cut).toContain('aria-label="Skip cutscene"');
    expect(cut).toContain('[Slurp groans and grabs]');
    const card = renderToStaticMarkup(createElement(DeathOverlay, {
      d: { phase: 'card', enemy: 'slurp', reduced: false, skip: false, caption: '', card: { kicker: 'RUN OVER · CASE 02', name: 'Slurp', flavour: DEATH_FLAVOUR.slurp, why: ['Your HP ran out after 3 hits.'], tally: '2:14 played · 2/3 clues · 3 hits', countdownS: 12 } },
      onSkip: () => {}, onContinue: () => {},
    }));
    for (const s of ['RUN OVER · CASE 02', 'Defeated by', 'mdeath__medal--slurp', 'WHY', '2:14 played', 'See results', 'Results in 12 s']) expect(card).toContain(s);
    expect(card).not.toContain('death-skip');
  });
});

// ------------------------------------------------------------------------------------------------- tally + components

describe('Tally (§1b) and static components', () => {
  it('counts rule events (enemy_detected / enemy_hit / hint_requested); legacy fallback only without final events', () => {
    const legacy = new TallyTracker(false);
    legacy.update([ev({ type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }), ev({ type: 'catch', catchNumber: 1, hpLost: 30, eggSecurityLost: 0, blocked: false })]);
    expect(legacy.view()).toMatchObject({ seen: 1, hits: 1, hints: 0 });
    const fin = new TallyTracker(true);
    fin.update([ev({ type: 'hyde_mode', from: 'PATROL', to: 'CHASE', reason: 'saw_player' }), ev({ type: 'enemy_detected', enemy: 'hyde', via: 'sight' }), ev({ type: 'catch', catchNumber: 1, hpLost: 30, eggSecurityLost: 0, blocked: false }), ev({ type: 'enemy_hit', enemy: 'hyde', hpLost: 30, blocked: false }), ev({ type: 'hint_requested', level: 1 })]);
    const v = fin.view();
    expect(v).toMatchObject({ seen: 1, hits: 1, hints: 1 });
    expect(v.bump).toEqual({ seen: 1, hits: 1, hints: 1 });
    expect(fin.view().bump).toEqual({ seen: 1, hits: 1, hints: 1 }); // no new increment, no new pulse
  });

  it('strip markup: kickers, data-state, coffin class, director chip, assertive only when hunting', () => {
    const html = renderToStaticMarkup(createElement(ThreatsStrip, { chips: [hydeChip('PATROL', 0.1, null), directorChip(life('crackstone', { active: false, phase: 'cooldown' }))!, slurpChip('CHASE', 1, null)] }));
    for (const s of ['>HYDE<', '>CRACKSTONE<', '>SLURP<', 'mhud-chip--slurp', 'data-state="CHASE"', 'is-director', '>Away<', 'CHASING YOU']) expect(html).toContain(s);
    expect((html.match(/aria-live="assertive"/g) ?? []).length).toBe(1);
  });

  it('Odds panel markup: DANGER SOON, risk-chip on the Hyde row, objective tag, grouped footer', () => {
    const html = renderToStaticMarkup(createElement(OddsPanel, { odds: buildOddsV3(oddsIn()) }));
    for (const s of ['Danger soon', 'data-testid="risk-chip"', 'data-band="low"', 'Hears you', 'Sees you', 'Finds you', '>CLUE<', 'Crackstone, Slurp: Rule-based estimate']) expect(html).toContain(s);
  });

  it('Ask Weems button (V cap, cooldown ring) + legend (4 chips, no Weems) + lens bar', () => {
    const b = renderToStaticMarkup(createElement(AskWeemsButton, { b: { state: 'cooldown', used: 1, sub: 'Ready in 12 s', cooldownS: 12, ring: 0.4, disabled: false }, onAsk: () => {} }));
    expect(b).toContain('Ready in 12 s');
    expect(b).toContain('mhud-weems__ring');
    expect(b).toMatch(/<kbd[^>]*>V<\/kbd>/);
    const leg = renderToStaticMarkup(createElement(AnalyticsLegend, { variant: 'pause' }));
    expect(leg.match(/alegend__chip /g)?.length).toBe(4);
    expect(leg).not.toMatch(/Weems/i);
    const lens = renderToStaticMarkup(createElement(LensBar, { lens: { enemy: 'slurp', auto: true, inactive: true, label: 'Slurp odds · auto · may appear', present: ['hyde', 'crackstone', 'slurp'] } }));
    expect(lens).toContain('Slurp odds');
    expect(lens).toContain('auto · may appear');
    expect(lens).toMatch(/<kbd[^>]*>X<\/kbd>/);
  });
});
