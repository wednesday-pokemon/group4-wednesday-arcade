// Odds panel v3 (docs/final/UX_FINAL.md §1c): ONE line per monster in fixed order (Hyde "Hears you" · Crackstone
// "Sees you" · Slurp "Finds you") + one objective row (CLUE top area / EGG top site / TOWER reach), and a footer that
// groups the exact source labels ("Hyde: ML estimate · Clue: Bayesian estimate" / "Crackstone, Slurp: Rule-based
// estimate"). Facts are words, never 0 / 100 %: "Hunting you" (full bar), "Seen now", "Hidden" (Crackstone / Slurp while
// the cabinet door is closed; empty bar). A despawned monster reads "Away" (muted, no bar); before a spawn / after its
// cooldown it reads "Next: {area}" with the director's spawn distribution grouped by area ("Rule-based estimate").
// Never invented: a monster without a number (no forecast) gets no row. Pure.
import type { LiveForecasts, SpawnProb } from '../../../mystery/analytics/types.ts';
import type { EnemyId, InvestigationState } from '../../../mystery/types.ts';
import { ENEMY_IDS } from '../../../mystery/types.ts';
import { bandOf, pctText, roundPct, type OddsBand, type OddsCell, type OddsFact } from '../../../ui/mystery/odds.ts';
import type { HudIconName } from '../../../ui/mystery/hud/HudIcon.tsx';
import type { EnemyLife } from './enemies.ts';
import { eggCells, type DeltaState, type OddsPhase } from './oddsModel.ts';
import { deltaText } from '../../../ui/mystery/odds.ts';

export type OddsRowTone = 'hyde' | 'crack' | 'slurp' | 'clue' | 'egg' | 'tower';
export type OddsRowKind = 'estimate' | 'fact' | 'next' | 'away';

export interface OddsV3Row {
  id: EnemyId | 'objective';
  tone: OddsRowTone;
  icon: HudIconName;
  /** Monster rows: "Hears you" / "Next: Archive" / "Away"; objective: the area / site name. */
  label: string;
  /** Objective rows only: CLUE / EGG / TOWER. */
  tag: string | null;
  kind: OddsRowKind;
  /** Display cell (null for Away). */
  cell: OddsCell | null;
  /** Bar width 0..100 (facts: Hunting you / Seen now = 100, Hidden = 0). */
  bar: number;
  /** Exact source label of an estimate (null for facts / Away). */
  source: string | null;
  /** Hyde row: the analytics risk band (data-band, kept from the old risk chip). */
  riskBand: 'low' | 'medium' | 'high' | null;
  delta: { text: string; dir: 'up' | 'down' } | null;
  aria: string;
}

export interface OddsV3View {
  phase: OddsPhase;
  rows: OddsV3Row[];
  footer: string[];
}

export const HIDDEN_ODDS_V3: OddsV3View = { phase: 'hidden', rows: [], footer: [] };

/** The public per-enemy inputs (built by the loop from the sim + analytics). */
export interface OddsMonsterIn {
  life: EnemyLife;
  /** Hyde: analytics.currentRisk() (15 s detection risk). */
  risk?: { p: number; band: 'low' | 'medium' | 'high'; label: string; detectedNow: boolean } | null;
  /** The monster hunts the player now (CHASE / ATTACK) → "Hunting you". */
  hunting: boolean;
  /** It sees the player now (not chasing) → "Seen now" (Crackstone / Slurp). */
  seesYou: boolean;
}

export interface OddsV3In {
  phase: OddsPhase;
  forecasts: LiveForecasts | null;
  investigation: InvestigationState | null;
  deltas: ReadonlyMap<string, DeltaState>;
  monsters: Partial<Record<EnemyId, OddsMonsterIn>>;
  /** The player is inside a cabinet with the door closed: Crackstone / Slurp read "Hidden". */
  doorClosed: boolean;
}

const LABEL: Record<EnemyId, string> = { hyde: 'Hears you', crackstone: 'Sees you', slurp: 'Finds you' };
const ICON: Record<EnemyId, HudIconName> = { hyde: 'claw', crackstone: 'hat', slurp: 'slurp' };
const TONE: Record<EnemyId, OddsRowTone> = { hyde: 'hyde', crackstone: 'crack', slurp: 'slurp' };
const NAME: Record<EnemyId, string> = { hyde: 'Hyde', crackstone: 'Crackstone', slurp: 'Slurp' };
export const SPAWN_SOURCE = 'Rule-based estimate';
/** Footer line budget (characters) — the panel is 256 px wide at 1366. */
export const FOOTER_LINE = 44;

/** Loose shape of the fullstack's `forecasts.slurp` (UX_FINAL asks: {here:{p, fact}, cells, horizonS, label}). */
export interface SlurpForecastLoose {
  here?: { p?: number; fact?: string | null } | null;
  cells?: { x: number; z: number; sizeM?: number; p: number }[];
  horizonS?: number;
  label?: string;
}

export function slurpForecastOf(f: LiveForecasts | null): SlurpForecastLoose | null {
  const s = f?.slurp;
  return s && typeof s === 'object' ? (s as SlurpForecastLoose) : null;
}

/** The director's spawn odds for an inactive enemy (threat map layer, or the Hyde's legacy emergence spawns). */
export function spawnOddsOf(f: LiveForecasts | null, enemy: EnemyId): SpawnProb[] | null {
  const layer = f?.threat?.enemies?.[enemy];
  if (layer?.state === 'inactive' && layer.spawns && layer.spawns.length) return layer.spawns;
  if (enemy === 'hyde' && f?.hyde.phase === 'before_emergence' && f.hyde.spawns.length) return f.hyde.spawns;
  return null;
}

/** Spawn odds grouped by area (spawn name), highest first. Sums are exact (the director's P per spawn). */
export function spawnAreas(spawns: readonly SpawnProb[]): { name: string; p: number; x: number; z: number }[] {
  const by = new Map<string, { name: string; p: number; x: number; z: number; n: number }>();
  for (const s of spawns) {
    const g = by.get(s.name);
    if (g) {
      g.p += s.p;
      g.x += s.x;
      g.z += s.z;
      g.n++;
    } else by.set(s.name, { name: s.name, p: s.p, x: s.x, z: s.z, n: 1 });
  }
  return [...by.values()].map((g) => ({ name: g.name, p: g.p, x: g.x / g.n, z: g.z / g.n })).sort((a, b) => b.p - a.p);
}

function estimateCell(p: number): OddsCell {
  const pct = roundPct(p);
  return { text: pctText(pct), pct, fact: null, band: bandOf(pct), p };
}

function factCell(fact: OddsFact, p = 0): OddsCell {
  return { text: fact, pct: null, fact, band: null, p };
}

const FACT_BAR: Partial<Record<OddsFact, number>> = { 'Hunting you': 100, 'Seen now': 100, Hidden: 0 };

function monsterRow(enemy: EnemyId, m: OddsMonsterIn, i: OddsV3In): OddsV3Row | null {
  const f = i.forecasts;
  const base = { id: enemy, tone: TONE[enemy], icon: ICON[enemy], tag: null, riskBand: null, delta: null } as const;
  const life = m.life;
  if (!life.present) return null;
  if (!life.active) {
    // Away while the cooldown runs; "Next: {area}" before the first spawn or once the cooldown is over
    const away = life.phase === 'cooldown' && (life.arrivesInS === null || life.arrivesInS > 0.05);
    if (away) return { ...base, label: 'Away', kind: 'away', cell: null, bar: 0, source: null, aria: `${NAME[enemy]}: away` };
    const spawns = spawnOddsOf(f, enemy);
    if (!spawns) return null;
    const top = spawnAreas(spawns)[0];
    if (!top || top.p <= 0) return null;
    const cell = estimateCell(top.p);
    return { ...base, label: `Next: ${top.name}`, kind: 'next', cell, bar: cell.pct ?? 0, source: SPAWN_SOURCE, aria: `${NAME[enemy]} may appear next at ${top.name}: ${cell.text}` };
  }
  // facts first (words, never 0 / 100 %)
  let fact: OddsFact | null = null;
  if (m.hunting) fact = 'Hunting you';
  else if (enemy !== 'hyde' && i.doorClosed) fact = 'Hidden';
  else if (enemy !== 'hyde' && m.seesYou) fact = 'Seen now';
  let p: number | null = null;
  let source: string | null = null;
  if (enemy === 'hyde') {
    if (m.risk) {
      if (m.risk.detectedNow) fact ??= 'Hunting you';
      p = m.risk.p;
      source = m.risk.label;
    }
  } else if (enemy === 'crackstone') {
    const c = f?.crackstone;
    if (c) {
      const cf = c.here.fact === 'hunting' ? 'Hunting you' : c.here.fact === 'hidden' ? 'Hidden' : c.here.fact === 'seen' ? 'Seen now' : null;
      fact ??= cf;
      p = c.here.p;
      source = c.label;
    }
  } else {
    const s = slurpForecastOf(f);
    const here = s?.here ?? null;
    if (here && typeof here.p === 'number') {
      const sf = here.fact === 'hunting' ? 'Hunting you' : here.fact === 'hidden' ? 'Hidden' : here.fact === 'seen' ? 'Seen now' : null;
      fact ??= sf;
      p = here.p;
      source = s?.label ?? SPAWN_SOURCE;
    } else {
      const layer = f?.threat?.enemies?.slurp;
      if (layer && layer.state === 'active' && typeof layer.here === 'number') {
        p = layer.here;
        source = layer.label;
      }
    }
  }
  if (fact) {
    const cell = factCell(fact, p ?? 0);
    return { ...base, riskBand: enemy === 'hyde' ? m.risk?.band ?? null : null, label: LABEL[enemy], kind: 'fact', cell, bar: FACT_BAR[fact] ?? 0, source: null, aria: `${NAME[enemy]}: ${fact}` };
  }
  if (p === null || source === null) return null;
  const cell = estimateCell(p);
  return {
    ...base, riskBand: enemy === 'hyde' ? m.risk?.band ?? null : null, label: LABEL[enemy], kind: 'estimate', cell, bar: cell.pct ?? 0, source,
    aria: `${NAME[enemy]} ${LABEL[enemy].toLowerCase()} in the next ${enemy === 'crackstone' ? 10 : 15} seconds: ${cell.text}, ${cell.band}`,
  };
}

function chip(deltas: ReadonlyMap<string, DeltaState>, id: string): OddsV3Row['delta'] {
  const d = deltas.get(id);
  return d ? { text: deltaText(d.from, d.to), dir: d.to >= d.from ? 'up' : 'down' } : null;
}

/** Row 4: find_clues → CLUE top area · find_egg / retrieve → EGG top site · deliver → TOWER reach. */
export function objectiveRow(i: OddsV3In): OddsV3Row | null {
  const f = i.forecasts;
  if (!f) return null;
  const base = { id: 'objective' as const, kind: 'estimate' as const, riskBand: null };
  if (i.phase === 'find_clues' || i.phase === 'dormant') {
    const areas = f.clueAreas?.areas ?? [];
    if (!f.clueAreas || !areas.length) return null;
    const top = [...areas].sort((a, b) => b.p - a.p)[0]!;
    if (top.p <= 0) return null;
    const cell = estimateCell(top.p);
    return { ...base, tone: 'clue', icon: 'search', tag: 'CLUE', label: top.name, cell, bar: cell.pct ?? 0, source: f.clueAreas.label, delta: chip(i.deltas, `area:${top.areaId}`), aria: `Clue likely in ${top.name}: ${cell.text}` };
  }
  if (i.phase === 'find_egg') {
    if (!f.egg || !f.egg.sites.length) return null;
    const cells = eggCells(f, i.investigation);
    const ranked = f.egg.sites.map((s, k) => ({ s, c: cells[k]! })).sort((a, b) => (b.c.fact === 'Seen' ? 2 : b.s.p) - (a.c.fact === 'Seen' ? 2 : a.s.p));
    const top = ranked[0]!;
    const fact = top.c.fact;
    return {
      ...base, kind: fact ? 'fact' : 'estimate', tone: 'egg', icon: 'egg', tag: 'EGG', label: top.s.label, cell: top.c, bar: fact === 'Seen' ? 100 : top.c.pct ?? 0,
      source: fact ? null : f.egg.label, delta: chip(i.deltas, `egg:${top.s.siteId}`), aria: `Egg likely at ${top.s.label}: ${top.c.text}`,
    };
  }
  if (i.phase === 'carry') {
    const cell = estimateCell(f.extraction.p);
    return { ...base, tone: 'tower', icon: 'gauge', tag: 'TOWER', label: 'Reach the tower', cell, bar: cell.pct ?? 0, source: f.extraction.label, delta: null, aria: `Reach the tower: ${cell.text}` };
  }
  return null;
}

/** Footer: groups of identical sources ("Crackstone, Slurp: Rule-based estimate"), packed into ≤ 2 lines. */
export function oddsFooter(rows: readonly OddsV3Row[]): string[] {
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.source) continue;
    const who = r.id === 'objective' ? (r.tag === 'CLUE' ? 'Clue' : r.tag === 'EGG' ? 'Egg' : 'Tower') : NAME[r.id];
    const g = groups.get(r.source) ?? [];
    if (!g.includes(who)) g.push(who);
    groups.set(r.source, g);
  }
  const parts = [...groups].map(([src, who]) => `${who.join(', ')}: ${src}`);
  // first-fit packing: a part joins the first line it fits on (≤ FOOTER_LINE chars), so the spec's layout comes out:
  // "Hyde: ML estimate · Clue: Bayesian estimate" / "Crackstone, Slurp: Rule-based estimate"
  const lines: string[] = [];
  for (const p of parts) {
    const i = lines.findIndex((l) => (l + ' · ' + p).length <= FOOTER_LINE);
    if (i >= 0) lines[i] = `${lines[i]} · ${p}`;
    else lines.push(p);
  }
  return lines;
}

/** Panel phase (row 4 choice): hidden in the tutorial, at the accusation and without forecasts. */
export function oddsV3Phase(status: string, objective: string, f: LiveForecasts | null): OddsPhase {
  if (status !== 'playing' || !f) return 'hidden';
  if (objective === 'find_clues') return 'find_clues';
  if (objective === 'find_egg' || objective === 'retrieve_egg') return 'find_egg';
  if (objective === 'deliver_egg') return 'carry';
  return 'hidden';
}

export function buildOddsV3(i: OddsV3In): OddsV3View {
  if (i.phase === 'hidden' || !i.forecasts) return HIDDEN_ODDS_V3;
  const rows: OddsV3Row[] = [];
  for (const e of ENEMY_IDS) {
    const m = i.monsters[e];
    if (!m) continue;
    const r = monsterRow(e, m, i);
    if (r) rows.push(r);
  }
  const ob = objectiveRow(i);
  if (ob) rows.push(ob);
  if (!rows.length) return HIDDEN_ODDS_V3;
  return { phase: i.phase, rows, footer: oddsFooter(rows) };
}

/** Monster rows keep their band ≥ 2 s (estimates only; facts and Away switch at once). */
export class OddsBandHold {
  private shown = new Map<string, { band: OddsBand; since: number }>();
  constructor(private readonly holdS = 2) {}
  apply(v: OddsV3View, now: number): OddsV3View {
    if (v.rows.length === 0) return v;
    const rows = v.rows.map((r) => {
      if (r.id === 'objective' || !r.cell?.band) {
        this.shown.delete(r.id);
        return r;
      }
      const prev = this.shown.get(r.id);
      if (!prev || prev.band === r.cell.band || now - prev.since >= this.holdS) {
        if (!prev || prev.band !== r.cell.band) this.shown.set(r.id, { band: r.cell.band, since: now });
        return r;
      }
      return { ...r, cell: { ...r.cell, band: prev.band } };
    });
    return { ...v, rows };
  }
}
