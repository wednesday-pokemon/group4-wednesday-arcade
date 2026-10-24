// HUD Odds panel view-model (UX_OVERHAUL §7.5): which probability groups show in which phase (≤ 4 rows), their rounded
// cells (largest remainder / facts as words — src/ui/mystery/odds.ts), exact source labels, and the observation-caused
// delta chips ("50% → 80%", ≥ 10 pts, 3 s; Hyde zones drift continuously and never get chips).
//   Hyde dormant          → HYDE MAY EMERGE AT: 3 spawns · CLUE: top area
//   find_clues            → HYDE LIKELY IN: top 2 zones · CLUE: top area · EGG: top site
//   find_egg              → HYDE: top zone · EGG LIKELY AT: 3 sites
//   retrieve / deliver    → HYDE LIKELY IN: top 3 · TOWER: extraction
//   tutorial / accuse     → hidden
// Joseph Crackstone (UX_ENEMIES §5): when the analytics sends `forecasts.crackstone` AND (his p for your spot ≥ 5 % or
// you are within 15 m of his cursed area), one hat row "Sees this spot · 10 s" joins and the Hyde gives up a row:
//   dormant Spawns 2 + Crackstone + Clue · find_clues Hyde 1 + Crackstone + Clue + Egg · find_egg Hyde 1 + Crackstone +
//   Egg 2 · carry Hyde 2 + Crackstone + Tower. Facts are words (Seen now / Hidden / Hunting you); its own footer line
//   "Crackstone · Rule-based estimate". Never invented: no forecast → no row.
import type { LiveForecasts } from '../../../mystery/analytics/types.ts';
import type { InvestigationState, Objective, RunStatus } from '../../../mystery/types.ts';
import { deltaText, oddsCells, pctText, roundPct, bandOf, type OddsCell } from '../../../ui/mystery/odds.ts';

export type OddsPhase = 'hidden' | 'dormant' | 'find_clues' | 'find_egg' | 'carry';

export interface OddsRow {
  /** Map item id ('zone:<id>' | 'spawn:<id>' | 'area:<id>' | 'egg:<id>' | 'tower') — hover link to the map. */
  id: string;
  name: string;
  cell: OddsCell;
  hyde: boolean;
  top: boolean;
  delta: { text: string; dir: 'up' | 'down' } | null;
}

export interface OddsGroup {
  id: 'hyde' | 'spawn' | 'clue' | 'egg' | 'tower' | 'crack';
  /** Multi-row header ("HYDE LIKELY IN"); null for single-row groups (they use `tag`). */
  title: string | null;
  /** Inline caps tag for single-row groups (HYDE, CLUE, EGG, TOWER); null for Crackstone (hat icon instead). */
  tag: string | null;
  rows: OddsRow[];
  source: string;
}

export interface OddsView {
  phase: OddsPhase;
  groups: OddsGroup[];
  /** One line when every group shares a source, else "Group · source" per group. */
  footer: string[];
}

export function oddsPhase(status: RunStatus, objective: Objective, f: LiveForecasts | null): OddsPhase {
  if (status !== 'playing' || objective === 'accuse' || objective === 'done' || !f) return 'hidden';
  if (f.hyde.phase === 'before_emergence') return 'dormant';
  if (objective === 'find_clues') return 'find_clues';
  if (objective === 'find_egg') return 'find_egg';
  return 'carry';
}

export interface DeltaState { from: number; to: number; until: number }

/**
 * Tracks rounded egg-site / clue-area values and creates delta chips when an OBSERVATION (trace, site checked, clue
 * found, sighting — counted by `epoch`) moved a value by ≥ 10 points. Hyde zones are never tracked.
 */
export class OddsDeltaTracker {
  private last = new Map<string, number>();
  private epoch = -1;
  readonly active = new Map<string, DeltaState>();
  /** The newest chip (ExamineToast's "Egg odds: … 50% → 80%"). */
  latest: { id: string; name: string; from: number; to: number; t: number } | null = null;

  /** Last rounded value of a tracked row ('egg:<siteId>' | 'area:<areaId>'). */
  lastPct(id: string): number | undefined {
    return this.last.get(id);
  }

  update(f: LiveForecasts | null, inv: InvestigationState | null, epoch: number, now: number): void {
    for (const [k, d] of this.active) if (now >= d.until) this.active.delete(k);
    if (!f) return;
    const cur = new Map<string, { pct: number; name: string }>();
    if (f.egg) {
      const cells = eggCells(f, inv);
      f.egg.sites.forEach((s, i) => {
        const c = cells[i]!;
        if (c.pct !== null) cur.set(`egg:${s.siteId}`, { pct: c.pct, name: s.label });
      });
    }
    if (f.clueAreas) for (const a of f.clueAreas.areas) cur.set(`area:${a.areaId}`, { pct: roundPct(a.p), name: a.name });
    const observed = epoch !== this.epoch;
    if (observed && this.epoch >= 0) {
      for (const [id, v] of cur) {
        const prev = this.last.get(id);
        if (prev !== undefined && Math.abs(v.pct - prev) >= 10) {
          this.active.set(id, { from: prev, to: v.pct, until: now + 3 });
          if (!this.latest || now - this.latest.t > 0.05 || v.pct > this.latest.to) this.latest = { id, name: v.name, from: prev, to: v.pct, t: now };
        }
      }
    }
    // only advance the baseline when observations arrived (or the first time), so slow drifts never look like a jump
    if (observed || this.epoch < 0) {
      this.last = new Map([...cur].map(([k, v]) => [k, v.pct]));
      this.epoch = epoch;
    }
  }
}

/** Egg-site cells with facts: Seen / Not here (ruled out). */
export function eggCells(f: LiveForecasts, inv: InvestigationState | null): OddsCell[] {
  const sites = f.egg?.sites ?? [];
  return oddsCells(sites.map((s) => {
    const seen = inv?.eggSeenAt === s.siteId;
    const out = !seen && (s.ruledOut || (inv?.eggSeenAt != null && inv.eggSeenAt !== s.siteId));
    return { p: s.p, fact: seen ? 'Seen' as const : out ? 'Not here' as const : null };
  }), { distribution: true });
}

function chip(deltas: ReadonlyMap<string, DeltaState>, id: string): OddsRow['delta'] {
  const d = deltas.get(id);
  return d ? { text: deltaText(d.from, d.to), dir: d.to >= d.from ? 'up' : 'down' } : null;
}

/** Crackstone row shown when p ≥ 5 % or the player is within 15 m of his cursed area. */
export const CRACK_ODDS_MIN_P = 0.05;
export const CRACK_ODDS_NEAR_M = 15;

const CRACK_FACT: Record<'seen' | 'hidden' | 'hunting', OddsCell['fact']> = { seen: 'Seen now', hidden: 'Hidden', hunting: 'Hunting you' };

/** The single Crackstone row ("Sees this spot · 10 s"), or null when not shown / no forecast. */
export function crackGroup(f: LiveForecasts | null, nearAreaM: number | null): OddsGroup | null {
  const c = f?.crackstone;
  if (!c) return null;
  const near = nearAreaM !== null && nearAreaM <= CRACK_ODDS_NEAR_M;
  if (!(c.here.p >= CRACK_ODDS_MIN_P) && !near && !c.here.fact) return null;
  const fact = c.here.fact ? CRACK_FACT[c.here.fact] ?? null : null;
  const pct = roundPct(c.here.p);
  const cell: OddsCell = fact ? { text: fact, pct: null, fact, band: null, p: c.here.p } : { text: pctText(pct), pct, fact: null, band: bandOf(pct), p: c.here.p };
  return {
    id: 'crack', title: null, tag: null,
    rows: [{ id: 'crack:here', name: `Sees this spot · ${Math.round(c.horizonS)} s`, cell, hyde: false, top: false, delta: null }],
    source: c.label,
  };
}

/** The panel for this phase, ≤ 4 rows. `crackNearM` = distance (m) to Crackstone's cursed area (0 inside), if any. */
export function buildOdds(phase: OddsPhase, f: LiveForecasts | null, inv: InvestigationState | null, deltas: ReadonlyMap<string, DeltaState>, crackNearM: number | null = null): OddsView {
  if (phase === 'hidden' || !f) return { phase: 'hidden', groups: [], footer: [] };
  const groups: OddsGroup[] = [];
  const crack = crackGroup(f, crackNearM);

  const hydeGroup = (n: number): OddsGroup | null => {
    if (f.hyde.phase !== 'active' || f.hyde.zones.length === 0) return null;
    const cells = oddsCells(f.hyde.zones.map((z) => ({ p: z.p })), { distribution: true });
    const rows = f.hyde.zones
      .map((z, i) => ({ z, c: cells[i]!, i }))
      .sort((a, b) => b.z.p - a.z.p || a.i - b.i)
      .slice(0, n)
      .map((r, k) => ({ id: `zone:${r.z.zoneId}`, name: r.z.name, cell: r.c, hyde: true, top: k === 0, delta: null }));
    return { id: 'hyde', title: n > 1 ? 'Hyde likely in' : null, tag: n > 1 ? null : 'Hyde', rows, source: f.hyde.label };
  };
  const clueGroup = (): OddsGroup | null => {
    const areas = f.clueAreas?.areas ?? [];
    if (!f.clueAreas || areas.length === 0) return null;
    const top = [...areas].sort((a, b) => b.p - a.p)[0]!;
    if (top.p <= 0) return null;
    const pct = roundPct(top.p);
    const cell: OddsCell = { text: pctText(pct), pct, fact: null, band: bandOf(pct), p: top.p };
    return { id: 'clue', title: null, tag: 'Clue', rows: [{ id: `area:${top.areaId}`, name: top.name, cell, hyde: false, top: true, delta: chip(deltas, `area:${top.areaId}`) }], source: f.clueAreas.label };
  };
  const eggGroup = (all: boolean): OddsGroup | null => {
    if (!f.egg || f.egg.sites.length === 0) return null;
    const cells = eggCells(f, inv);
    const ranked = f.egg.sites
      .map((s, i) => ({ s, c: cells[i]!, i }))
      .sort((a, b) => (b.c.fact === 'Seen' ? 2 : b.s.p) - (a.c.fact === 'Seen' ? 2 : a.s.p) || a.i - b.i);
    const rows = (all ? ranked : ranked.slice(0, 1)).map((r, k) => ({
      id: `egg:${r.s.siteId}`, name: r.s.label, cell: r.c, hyde: false, top: k === 0 && r.c.fact !== 'Not here', delta: chip(deltas, `egg:${r.s.siteId}`),
    }));
    return { id: 'egg', title: all ? 'Egg likely at' : null, tag: all ? null : 'Egg', rows, source: f.egg.label };
  };

  if (phase === 'dormant' && f.hyde.phase === 'before_emergence') {
    const cells = oddsCells(f.hyde.spawns.map((s) => ({ p: s.p })), { distribution: true });
    const rows = f.hyde.spawns
      .map((s, i) => ({ s, c: cells[i]!, i }))
      .sort((a, b) => b.s.p - a.s.p || a.i - b.i)
      .slice(0, crack ? 2 : 3)
      .map((r, k) => ({ id: `spawn:${r.s.spawnId}`, name: r.s.name, cell: r.c, hyde: true, top: k === 0, delta: null }));
    if (rows.length) groups.push({ id: 'spawn', title: 'Hyde may emerge at', tag: null, rows, source: f.hyde.label });
    if (crack) groups.push(crack);
    const c = clueGroup();
    if (c) groups.push(c);
  } else if (phase === 'find_clues') {
    for (const g of [hydeGroup(crack ? 1 : 2), crack, clueGroup(), eggGroup(false)]) if (g) groups.push(g);
  } else if (phase === 'find_egg') {
    for (const g of [hydeGroup(1), crack, eggGroup(true)]) if (g) groups.push(g);
  } else if (phase === 'carry') {
    const h = hydeGroup(crack ? 2 : 3);
    if (h) groups.push(h);
    if (crack) groups.push(crack);
    const pct = roundPct(f.extraction.p);
    groups.push({
      id: 'tower', title: null, tag: 'Tower',
      rows: [{ id: 'tower', name: 'Reach the tower', cell: { text: pctText(pct), pct, fact: null, band: bandOf(pct), p: f.extraction.p }, hyde: false, top: true, delta: null }],
      source: f.extraction.label,
    });
  }
  // ≤ 4 rows in total (trim from the last group)
  let total = groups.reduce((s, g) => s + g.rows.length, 0);
  for (let i = groups.length - 1; i >= 0 && total > 4; i--) {
    const g = groups[i]!;
    while (g.rows.length > 1 && total > 4) {
      g.rows.pop();
      total--;
    }
  }
  // Crackstone has its own footer line; the others keep the shared-source rule
  const rest = groups.filter((g) => g.id !== 'crack');
  const sources = [...new Set(rest.map((g) => g.source))];
  const footer = sources.length <= 1 ? sources : rest.map((g) => `${GROUP_NAME[g.id]} · ${g.source}`);
  const cg = groups.find((g) => g.id === 'crack');
  if (cg) footer.push(`${GROUP_NAME.crack} · ${cg.source}`);
  return { phase, groups, footer };
}

const GROUP_NAME: Record<OddsGroup['id'], string> = { hyde: 'Hyde', spawn: 'Hyde', clue: 'Clue', egg: 'Egg', tower: 'Tower', crack: 'Crackstone' };
