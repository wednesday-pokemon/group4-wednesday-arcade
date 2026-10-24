// Pure view-model of the Tab "Investigation" overlay (docs/overhaul/UX_OVERHAUL.md §4, §7; rulings R2, R3).
// Reads ONLY public data: the CaseDef, the CaseWorldDef priors / areas, the player's InvestigationState and the analytics
// layer's LiveForecasts. Never MapDef.clues / MapDef.eggSpawn / SessionLayout — a locked slot names the AREAS still to
// search, never the drawn site. Display rules (5 % rounding, largest remainder, bands, facts as words, source labels)
// come from odds.ts so the HUD Odds panel, the maps and this overlay can never disagree.
import { clueAreaProbabilities, eggPosterior } from '../../mystery/analytics/bayes.ts';
import type { LiveForecasts, RiskBand } from '../../mystery/analytics/types.ts';
import type { CaseDef, CaseWorldDef, ClueDef, ClueId, InvestigationState } from '../../mystery/types.ts';
import { deltaText, oddsCells, roundPct, SOURCE_LABEL, type OddsBand, type OddsInput } from './odds.ts';

// ----------------------------------------------------------------------------------------------------- evidence slots

export interface FoundSlot {
  kind: 'found';
  index: number; // 0-based case order ("EVIDENCE 1")
  clueId: ClueId;
  title: string;
  icon: ClueDef['icon'];
  /** TL;DR line (ClueDef.short, else the first sentence of the text). */
  short: string;
  /** "Meaning:" line (ClueDef.meaning, else the neutral board deduction). */
  meaning: string;
  /** Full text + deduction, shown when the slot is expanded. */
  text: string;
  deduction: string;
  /** Names the clue text mentions (neutral chips, suspect order). */
  mentions: string[];
}

export interface LockedSlot {
  kind: 'locked';
  index: number;
  clueId: ClueId;
  /** "Search: Maintenance Tunnel, Crypt · 2 spots left" (or "Search: <location>" without a case world). */
  search: string;
  /** Area ids still worth searching (for the map highlight); empty without a world. */
  areaIds: string[];
  /** Candidate site ids not yet checked (map highlight; public candidates, never the drawn site). */
  siteIds: string[];
  spotsLeft: number | null;
  /** The clue was seen (not yet picked up): its spot is public now. */
  spotted: boolean;
}

export type EvidenceSlot = FoundSlot | LockedSlot;

/** Names mentioned in a clue's text, in suspect order (neutral; pure). */
export function mentionNames(caseDef: CaseDef, clue: ClueDef): string[] {
  return caseDef.suspects.filter((s) => clue.mentions.includes(s.id)).map((s) => s.name);
}

/** First sentence of a clue text, ≤ 90 chars (fallback while ClueDef.short is missing). */
export function firstSentence(text: string, max = 90): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  const s = (m?.[1] ?? text).trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The three evidence slots in case order (pure; unit-tested for secrecy). */
export function evidenceSlots(
  caseDef: CaseDef,
  cluesFound: readonly ClueId[],
  world: CaseWorldDef | null | undefined,
  inv: InvestigationState | null | undefined,
): EvidenceSlot[] {
  return caseDef.clues.map((c, index): EvidenceSlot => {
    if (cluesFound.includes(c.id)) {
      return {
        kind: 'found', index, clueId: c.id, title: c.title, icon: c.icon,
        short: c.short?.trim() || firstSentence(c.text),
        meaning: c.meaning?.trim() || c.deduction,
        text: c.text, deduction: c.deduction, mentions: mentionNames(caseDef, c),
      };
    }
    const group = world?.clueSites.find((g) => g.clueId === c.id);
    if (!world || !group) {
      return { kind: 'locked', index, clueId: c.id, search: `Search: ${c.location}`, areaIds: [], siteIds: [], spotsLeft: null, spotted: false };
    }
    const areaName = (id: string) => world.areas.find((a) => a.id === id)?.name ?? c.location;
    const known = inv?.knownClueSites[c.id];
    const knownSite = known ? group.sites.find((s) => s.id === known) : undefined;
    if (knownSite) {
      return {
        kind: 'locked', index, clueId: c.id, search: `Spotted: ${knownSite.label} · ${areaName(knownSite.areaId)}`,
        areaIds: [knownSite.areaId], siteIds: [knownSite.id], spotsLeft: 1, spotted: true,
      };
    }
    const checked = new Set(inv?.checkedClueSites ?? []);
    const left = group.sites.filter((s) => !checked.has(s.id));
    const areaIds = [...new Set(left.map((s) => s.areaId))];
    const names = areaIds.map(areaName);
    // Without the player's observations the count of spots LEFT is unknown: name the areas only.
    const search = left.length === 0 ? `Search: ${c.location}` : inv ? `Search: ${names.join(', ')} · ${plural(left.length, 'spot')} left` : `Search: ${names.join(', ')}`;
    return { kind: 'locked', index, clueId: c.id, search, areaIds, siteIds: left.map((s) => s.id), spotsLeft: inv ? left.length : null, spotted: false };
  });
}

// ----------------------------------------------------------------------------------------------------- the odds

/** What a row highlights on the map (and what a map hover highlights in the odds). */
export interface MapRef { kind: 'zone' | 'spawn' | 'egg' | 'area' | 'tower'; id: string }

export interface OddsRowView {
  key: string;
  name: string;
  /** "45%", "<5%", ">95%" or a fact word ("Not here", "Seen"). */
  value: string;
  /** Rounded percent for the bar (null = a fact, no bar). */
  pct: number | null;
  band: OddsBand | null;
  /** Band word, or for risk the model's band ("Low" / "Medium" / "High"). */
  bandText: string | null;
  top: boolean;
  tone: 'hyde' | 'predict' | 'crack';
  ref: MapRef | null;
}

export interface OddsBlockView {
  id: 'hyde' | 'egg' | 'clues' | 'tower' | 'crack';
  question: string;
  /** Small line under the question ("Emerges in 0:20"). */
  note: string | null;
  rows: OddsRowView[];
  /** A fact shown instead of rows ("You carry the egg."). */
  fact: string | null;
  /** One-line history for the top egg site ("50% → 80% · Straw trace"). */
  history: string | null;
  /** Exact source label + how clause ("Bayesian estimate · priors, traces, searched spots"). */
  source: string;
}

export const ODDS_FOOTER = 'Estimates, not facts. They change as you learn more.';

const BAND_WORD: Record<OddsBand, string> = { likely: 'likely', maybe: 'maybe', unlikely: 'unlikely' };
const RISK_WORD: Record<RiskBand, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** m:ss */
export function clock(s: number): string {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

function rows(
  items: { key: string; name: string; p: number; fact?: OddsInput['fact']; ref: MapRef | null }[],
  o: { distribution: boolean; tone: OddsRowView['tone'] },
): OddsRowView[] {
  const cells = oddsCells(items.map((i) => ({ p: i.p, fact: i.fact ?? null })), { distribution: o.distribution });
  const out = items.map((it, k): OddsRowView => {
    const c = cells[k]!;
    return { key: it.key, name: it.name, value: c.text, pct: c.pct, band: c.band, bandText: c.band ? BAND_WORD[c.band] : null, top: false, tone: o.tone, ref: it.ref };
  });
  // Estimates by probability (desc), facts last; stable on ties.
  const order = out.map((r, i) => ({ r, i, p: items[i]!.p }))
    .sort((a, b) => Number(a.r.pct === null) - Number(b.r.pct === null) || b.p - a.p || a.i - b.i)
    .map((x) => x.r);
  const first = order.find((r) => r.pct !== null);
  if (first) first.top = true;
  return order;
}

/** Keep one of the three exact labels; anything else falls back to `fallback`. */
function exactLabel(label: string | undefined, fallback: string): string {
  return label && (Object.values(SOURCE_LABEL) as string[]).includes(label) ? label : fallback;
}

export interface OddsContext {
  forecasts: LiveForecasts | null | undefined;
  world: CaseWorldDef | null | undefined;
  investigation: InvestigationState | null | undefined;
  cluesFound: readonly ClueId[];
  clueTotal: number;
  /** 'carried' / 'delivered' replace the egg rows with a fact line when the forecasts are missing. */
  eggState?: 'resting' | 'carried' | 'dropped' | 'delivered' | null;
}

/**
 * The four blocks of THE ODDS column. Uses the live forecasts when present; without them (analytics not wired yet) the
 * egg and clue blocks fall back to the same Bayesian posteriors computed from the world + the player's investigation
 * state (both required), and the Hyde / tower blocks say they are not available — never invented numbers.
 */
export function oddsBlocks(x: OddsContext): OddsBlockView[] {
  const out = [hydeBlock(x), eggBlock(x), clueBlock(x), towerBlock(x)];
  const c = crackBlock(x);
  if (c) out.push(c);
  return out;
}

const CRACK_FACT_WORD = { seen: 'Seen now', hidden: 'Hidden', hunting: 'Hunting you' } as const;

/**
 * "Will Crackstone see you?" (UX_ENEMIES §5) — only in cases with Crackstone. The rule-based forecast for your spot
 * (facts as words); without the analytics forecast it says so (never an invented number).
 */
export function crackBlock({ forecasts, world }: OddsContext): OddsBlockView | null {
  const c = forecasts?.crackstone ?? null;
  if (!c && !world?.crackstone) return null;
  const base = { id: 'crack' as const, question: 'Will Crackstone see you?', note: null, history: null, source: `${SOURCE_LABEL.rule} · his patrol route, sight rules, last sighting` };
  if (!c) return { ...base, rows: [], fact: 'Not available yet.' };
  const fact = c.here.fact ? CRACK_FACT_WORD[c.here.fact] : null;
  const cell = oddsCells([{ p: c.here.p, fact }], { distribution: false })[0]!;
  return {
    ...base, fact: null,
    rows: [{ key: 'crack-here', name: `Sees your spot · ${Math.round(c.horizonS)} s`, value: cell.text, pct: cell.pct, band: cell.band, bandText: cell.band ? BAND_WORD[cell.band] : null, top: false, tone: 'crack', ref: null }],
  };
}

function hydeBlock({ forecasts }: OddsContext): OddsBlockView {
  const h = forecasts?.hyde;
  if (!h) {
    return { id: 'hyde', question: 'Where is the Hyde likely?', note: null, rows: [], fact: 'Not available yet.', history: null, source: `${SOURCE_LABEL.bayes} · patrol route + what you saw and heard` };
  }
  if (h.phase === 'before_emergence') {
    return {
      id: 'hyde', question: 'Where may it emerge?', note: `Emerges in ${clock(h.emergesInS)}`, fact: null, history: null,
      rows: rows(h.spawns.map((s) => ({ key: s.spawnId, name: s.name, p: s.p, ref: { kind: 'spawn', id: s.spawnId } })), { distribution: true, tone: 'hyde' }),
      source: `${exactLabel(h.label, SOURCE_LABEL.rule)} · case spawn rules`,
    };
  }
  return {
    id: 'hyde', question: 'Where is the Hyde likely?', note: null, fact: null, history: null,
    rows: rows(h.zones.map((z) => ({ key: z.zoneId, name: z.name, p: z.p, ref: { kind: 'zone', id: z.zoneId } })), { distribution: true, tone: 'hyde' }),
    source: `${exactLabel(h.label, SOURCE_LABEL.bayes)} · patrol route + what you saw and heard`,
  };
}

function eggBlock({ forecasts, world, investigation, eggState }: OddsContext): OddsBlockView {
  const base = { id: 'egg' as const, question: 'Where is the egg likely?', note: null, source: `${SOURCE_LABEL.bayes} · priors, traces, searched spots` };
  if (eggState === 'carried') return { ...base, rows: [], fact: 'You carry the egg.', history: null };
  if (eggState === 'delivered') return { ...base, rows: [], fact: 'Egg secured.', history: null };
  let sites: { siteId: string; label: string; p: number; prevP: number | null; ruledOut: boolean }[] | null = null;
  let change: { reason: string } | null = null;
  if (forecasts) {
    if (forecasts.egg === null) return { ...base, rows: [], fact: eggState === 'dropped' ? 'Egg dropped — go back for it.' : 'You carry the egg.', history: null };
    sites = forecasts.egg.sites;
    change = forecasts.egg.lastChange;
  } else if (world && investigation && world.eggSites.length > 0) {
    // Same posterior the analytics layer computes, from the same public inputs (never the priors alone: they would
    // ignore what the player already searched).
    const post = eggPosterior(world, investigation);
    sites = world.eggSites.map((s, i) => ({ siteId: s.id, label: s.label, p: post[i]?.p ?? 0, prevP: null, ruledOut: post[i]?.ruledOut ?? false }));
  }
  if (!sites || sites.length === 0) return { ...base, rows: [], fact: 'Not available yet.', history: null };
  const seen = investigation?.eggSeenAt ?? (sites.find((s) => s.p >= 1 - 1e-9 && sites!.every((o) => o === s || o.ruledOut))?.siteId ?? null);
  const list = rows(sites.map((s) => ({
    key: s.siteId, name: s.label, p: s.p, ref: { kind: 'egg', id: s.siteId },
    fact: seen ? (s.siteId === seen ? 'Seen' : 'Not here') : s.ruledOut ? 'Not here' : null,
  })), { distribution: true, tone: 'predict' });
  const top = list.find((r) => r.top);
  const topSite = top ? sites.find((s) => s.siteId === top.key) : undefined;
  const history = top && top.pct !== null && topSite && topSite.prevP !== null && change
    ? `${deltaText(roundPct(topSite.prevP), top.pct)} · ${change.reason}`
    : null;
  return { ...base, rows: list, fact: null, history };
}

function clueBlock({ forecasts, world, investigation, cluesFound, clueTotal }: OddsContext): OddsBlockView {
  const base = { id: 'clues' as const, question: 'Where are the clues likely?', note: null, history: null, source: `${SOURCE_LABEL.bayes} · case priors, searched spots` };
  if (cluesFound.length >= clueTotal) return { ...base, rows: [], fact: `All ${clueTotal} clues found.` };
  let areas: { areaId: string; name: string; p: number }[] | null = null;
  if (forecasts?.clueAreas) areas = forecasts.clueAreas.areas;
  else if (world && investigation) areas = clueAreaProbabilities(world, investigation, cluesFound);
  if (!areas) return { ...base, rows: [], fact: 'Not available yet.' };
  const open = areas.filter((a) => a.p > 1e-9);
  if (open.length === 0) return { ...base, rows: [], fact: `All ${clueTotal} clues found.` };
  // Independent probabilities ("≥ 1 clue here"): rounded one by one, never forced to sum to 100.
  return { ...base, fact: null, rows: rows(open.map((a) => ({ key: a.areaId, name: a.name, p: a.p, ref: { kind: 'area', id: a.areaId } })), { distribution: false, tone: 'predict' }) };
}

function towerBlock({ forecasts }: OddsContext): OddsBlockView {
  const base = { id: 'tower' as const, question: 'Will you reach the tower?', note: null, history: null };
  if (!forecasts) return { ...base, rows: [], fact: 'Not available yet.', source: SOURCE_LABEL.rule };
  const ex = forecasts.extraction;
  const exLabel = ex.source === 'ml' ? SOURCE_LABEL.ml : SOURCE_LABEL.rule;
  const exPct = roundPct(ex.p);
  const exCell = oddsCells([{ p: ex.p }], { distribution: false })[0]!;
  const out: OddsRowView[] = [{
    key: 'extraction', name: 'Reach the tower', value: exCell.text, pct: exPct, band: exCell.band, bandText: exCell.band ? BAND_WORD[exCell.band] : null,
    top: false, tone: 'predict', ref: { kind: 'tower', id: 'tower' },
  }];
  const d = forecasts.detection;
  let source = `Tower: ${exLabel}`;
  if (d) {
    const dCell = oddsCells([{ p: d.p }], { distribution: false })[0]!;
    out.push({ key: 'detection', name: 'Detected in 15 s', value: dCell.text, pct: dCell.pct, band: dCell.band, bandText: RISK_WORD[d.band], top: false, tone: 'hyde', ref: null });
    source += ` · Risk: ${d.source === 'ml' ? SOURCE_LABEL.ml : SOURCE_LABEL.ruleRisk}`;
  } else {
    source += ' · Risk: Hyde not out yet';
  }
  return { ...base, rows: out, fact: null, source };
}

// ----------------------------------------------------------------------------------------------------- accusation

/** R3: naming a suspect needs every clue of the case. */
export function canNameSuspect(caseDef: CaseDef, cluesFound: readonly ClueId[]): boolean {
  return caseDef.clues.every((c) => cluesFound.includes(c.id));
}

/** Words the clue UI must never use (copy guard; the accusation QUESTION may ask "Who released the Hyde?"). */
export const BANNED_CLUE_WORDS = /\b(culprit|guilty|did it|released the hyde)\b/i;
