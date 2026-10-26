// Principal Weems — the OPTIONAL, PAID hint guide (FINAL_CONTRACT §8, UX_FINAL §4). The sim emits `hint_requested
// {level}` (−50 each, cooldown, ladder reset per objective step); this module only provides the CONTENT of that level,
// from the designer's lines (src/mystery/data/thing.ts WEEMS) and the PUBLIC posteriors:
//   L1  general search area — WEEMS.templates[1] filled with the most probable area for the current step (Bayesian; it
//       may be wrong — the line says "begin there", not "it is there"); without one, the case's fixed L1 line;
//   L2  a specific spot — WEEMS.templates[2] with the most probable candidate site in that area — or, when there is no
//       location to give (all clues found / accusation), the case's evidence-relationship line (byCase[2]);
//   L3  deduction guidance — the case's byCase[3] line (index = L3 hints already given, clamped), else templates[3].
//       Never a suspect's name, never "X did it".
// Carrying / dropped egg: plain objective lines (Iago Tower / where it fell). Every output ≤ 90 chars; a final guard
// replaces any line that names a suspect (accent-insensitive) with the neutral template.
import { WEEMS } from '../data/thing.ts';
import type { MysteryRun } from '../run.ts';
import { investigationOf } from './publicState.ts';
import type { WeemsHint } from './types.ts';
import { publicView, topEggSite } from './view.ts';

export const WEEMS_TITLE = 'PRINCIPAL WEEMS' as const;
export const WEEMS_MAX = 90;

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, k: string) => vars[k] ?? whole);
}

function fit(s: string): string {
  return s.length <= WEEMS_MAX ? s : `${s.slice(0, WEEMS_MAX - 1).trimEnd()}…`;
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Every suspect name token of the case (ids + name parts ≥ 4 letters), folded. */
function nameTokens(run: Pick<MysteryRun, 'caseDef'>): string[] {
  const out = new Set<string>();
  for (const s of run.caseDef.suspects) {
    out.add(fold(s.id));
    for (const part of s.name.split(/[\s'’-]+/)) if (part.length >= 4) out.add(fold(part));
  }
  return [...out];
}

/** True when the text names a suspect (accent-insensitive, whole word). */
export function namesSuspect(run: Pick<MysteryRun, 'caseDef'>, text: string): boolean {
  const t = fold(text);
  return nameTokens(run).some((n) => new RegExp(`\\b${n}\\b`).test(t));
}

/** A filled line that resolves every placeholder and names nobody, else null. */
function usable(run: MysteryRun, template: string | undefined, vars: Record<string, string> = {}): string | null {
  if (!template) return null;
  const s = fill(template, vars);
  if (/\{\w+\}/.test(s) || namesSuspect(run, s)) return null;
  return fit(s);
}

/** One candidate line of a level: text + basis + optional map target. */
interface Cand { text: string; basis: WeemsHint['basis']; target: WeemsHint['target'] }

/** Extra case-neutral lines so every level always has something NEW to say (never a name). */
const GENERAL_L1 = ['Every clue in this case sits somewhere on your map. Walk the marked areas.', 'Search where the case file says the night went wrong.'];
const GENERAL_L2 = ['Read each clue against the statements on your board: the times must agree.', 'One clue explains how; another explains when. Pair them.'];
const GENERAL_L3 = ['Lay your clues side by side. Who is explained, and who is not?', 'An alibi either survives the evidence or it does not. Test each one.', 'Method, chance, a broken alibi: one person carries all three.'];

/**
 * The three candidate lists of the current moment (public information only), best first per level:
 *   L1 general area (designer template filled with the most probable area, then the case's L1 lines);
 *   L2 specific spot (template with the most probable site there) or the case's evidence-relationship lines;
 *   L3 the case's deduction lines, then the template / general deduction lines.
 * `given[l]` = hints of level l already given this run (rotates the case's fixed lines).
 */
function candidates(run: MysteryRun, given: Record<1 | 2 | 3, number>): Record<1 | 2 | 3, Cand[]> {
  const caseLines = (level: 1 | 2 | 3): string[] => {
    const fixed = WEEMS.byCase[run.caseDef.id]?.[level] ?? [];
    const k = fixed.length ? Math.min(given[level], fixed.length - 1) : 0;
    return [...fixed.slice(k), ...fixed.slice(0, k)];
  };
  const line = (t: string | null | undefined, basis: WeemsHint['basis'], target: WeemsHint['target'] = null): Cand[] => (t ? [{ text: t, basis, target }] : []);
  const fixed = (level: 1 | 2 | 3, basis: WeemsHint['basis']) => caseLines(level).flatMap((t) => line(usable(run, t), basis));
  const general = (xs: readonly string[], basis: WeemsHint['basis']) => xs.flatMap((t) => line(usable(run, t), basis));
  const out: Record<1 | 2 | 3, Cand[]> = { 1: [], 2: [], 3: [] };
  out[3] = [...fixed(3, 'deduction'), ...line(usable(run, WEEMS.templates[3]), 'deduction'), ...general(GENERAL_L3, 'deduction')];
  const view = publicView(run, null);
  const obj = run.objective();
  const p = run.player;
  if (obj === 'deliver_egg') {
    const tw = { x: run.map.tower.x, z: run.map.tower.z, label: 'Iago Tower' };
    out[1] = line('Iago Tower waits for that egg. Carry it there, quietly.', 'case_line', tw);
    out[2] = line('Step inside the tower circle and hold E. Nothing more.', 'case_line', tw);
  } else if (obj === 'retrieve_egg' && view.eggKnownAt) {
    const at = { ...view.eggKnownAt, label: 'Dropped egg' };
    out[1] = line('The egg lies where it fell. Retrieve it before anything else.', 'case_line', at);
    out[2] = line('Walk to it, press E to lift it, then make for Iago Tower.', 'case_line', at);
  } else if (obj === 'accuse' || obj === 'done') {
    out[1] = [...line('Weigh each clue: who had the means, the chance, the motive?', 'case_line'), ...fixed(1, 'case_line')];
    out[2] = [...fixed(2, 'deduction'), ...general(GENERAL_L2, 'deduction')];
  } else if (obj === 'find_clues' && view.world) {
    const areas = view.areas.filter((a) => a.p > 1e-6).sort((a, b) => b.p - a.p || Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const top = areas[0];
    if (top) {
      const at = { x: top.x, z: top.z, label: top.name };
      out[1] = line(usable(run, WEEMS.templates[1], { area: top.name }) ?? `Begin in the ${top.name}.`, 'bayes', at);
      const site = view.clueSites.filter((x) => x.areaId === top.areaId && x.p > 1e-6).sort((a, b) => b.p - a.p)[0];
      if (site) out[2] = line(usable(run, WEEMS.templates[2], { label: site.label, area: top.name }) ?? `The ${site.label}, in the ${top.name}.`, 'bayes', { x: site.x, z: site.z, label: site.label });
    }
    out[1].push(...fixed(1, 'case_line'));
    out[2].push(...fixed(2, 'case_line'));
  } else if (view.world && run.egg.state === 'resting') {
    const top = topEggSite(view, p);
    if (top) {
      const area = view.world.areas.find((a) => a.id === top.def.areaId);
      const site = { x: top.def.x, z: top.def.z, label: top.def.label };
      if (investigationOf(run).eggSeenAt === top.def.id) {
        out[1] = line(`You have seen the egg. It waits at the ${top.def.label}.`, 'case_line', site);
        out[2] = line('Lift it with E, then carry it to Iago Tower. Mind the noise.', 'case_line', site);
      } else {
        if (area) out[1] = line(usable(run, WEEMS.templates[1], { area: area.name }) ?? `Begin in the ${area.name}.`, 'bayes', { x: area.x, z: area.z, label: area.name });
        out[2] = line(usable(run, WEEMS.templates[2], { label: top.def.label, area: area?.name ?? 'grounds' }) ?? `The ${top.def.label}.`, 'bayes', site);
      }
    }
  }
  out[1].push(...general(GENERAL_L1, 'case_line'));
  out[2].push(...general(GENERAL_L2, 'case_line'));
  return out;
}

/**
 * The ladder of this moment: three DISTINCT lines (L1 ≠ L2 ≠ L3 — each level says something new). Public information
 * only; never a suspect's name.
 */
export function weemsLadder(run: MysteryRun, given: Partial<Record<1 | 2 | 3, number>> = {}): [Cand, Cand, Cand] {
  const c = candidates(run, { 1: given[1] ?? 0, 2: given[2] ?? 0, 3: given[3] ?? 0 });
  const used = new Set<string>();
  const pick = (xs: Cand[], fallback: Cand): Cand => {
    for (const x of xs) {
      const t = fit(x.text);
      if (!used.has(t) && !namesSuspect(run, t)) {
        used.add(t);
        return { ...x, text: t };
      }
    }
    used.add(fallback.text);
    return fallback;
  };
  const l1 = pick(c[1], { text: GENERAL_L1[0], basis: 'case_line', target: null });
  const l2 = pick(c[2], { text: GENERAL_L2[1], basis: 'case_line', target: null });
  const l3 = pick(c[3], { text: GENERAL_L3[2], basis: 'deduction', target: null });
  return [l1, l2, l3];
}

/**
 * Weems' hint for `level` now. `given` = hints of THIS level already given this run (rotates the case's fixed lines);
 * the other levels of the ladder are computed with the same counts so the three lines stay distinct.
 */
export function weemsHint(run: MysteryRun, level: 1 | 2 | 3, given = 0): WeemsHint {
  const t = Math.round(run.t * 1000) / 1000;
  const ladder = weemsLadder(run, { [level]: given });
  const c = ladder[level - 1];
  return { id: `weems:${level}:${t.toFixed(2)}`, kind: 'weems', title: WEEMS_TITLE, level, text: c.text, basis: level === 3 ? 'deduction' : c.basis, t, target: c.target };
}
