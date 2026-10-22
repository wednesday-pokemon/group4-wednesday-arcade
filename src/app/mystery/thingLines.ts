// Thing's subtitle lines: the app-side resolver over the game-designer's script (src/mystery/data/thing.ts).
// Rules (plan §9): short, non-blocking, never names or hints at the culprit, never claims to compute analytics.
import { formatThingLine, THING, THING_STAY_SILENT, type ThingLine, type ThingPose, type TutorialLine } from '../../mystery/data/thing.ts';
import type { CaseDef, ClueId, DnfReason, HydeMode, Objective, Verdict } from '../../mystery/types.ts';

/** The exact tutorial sentence required by plan §7 / master prompt §5. */
export const STAY_SILENT_LINE = THING_STAY_SILENT;
export const HOME_TAGLINE = 'Stay Silent. Read the Clues. Escape the Hyde.';

export interface SpokenLine { id: string; text: string; pose: ThingPose }

export interface ThingVars {
  character?: string;
  pokemon?: string;
  power?: string;
  move?: string;
  n?: number;
  total?: number;
}

function speak(l: ThingLine, vars: ThingVars = {}): SpokenLine {
  const v: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(vars)) if (val !== undefined) v[k] = val;
  return { id: l.id, text: formatThingLine(l.text, v), pose: l.pose };
}

export const thing = {
  welcome: (): SpokenLine[] => THING.welcome.map((l) => speak(l)),
  duoIntro: (vars: ThingVars) => speak(THING.duoIntro, vars),
  /** The case's own egg line for find_egg (the hiding place differs per case). */
  objective: (o: Objective, caseDef?: CaseDef): SpokenLine | null => {
    if (o === 'done') return null;
    const l = THING.objective[o];
    return o === 'find_egg' && caseDef ? { id: l.id, text: caseDef.thing.findEgg, pose: l.pose } : speak(l);
  },
  /** The clue's own line from the case (content-neutral), else the generic one. */
  clueFound: (caseDef: CaseDef, id: ClueId): SpokenLine => {
    const text = caseDef.clues.find((c) => c.id === id)?.thing.found;
    return text ? { id: `clue_${id}`, text, pose: 'point' } : speak(THING.clueFound);
  },
  clueCount: (n: number) => speak(THING.clueCount[Math.min(3, Math.max(1, n)) as 1 | 2 | 3]),
  /** Alternates between the variants of a Hyde mode line. */
  threat: (mode: HydeMode, k: number) => {
    const ls = THING.threat[mode];
    return speak(ls[k % ls.length]!);
  },
  catchFirst: () => speak(THING.catch.first),
  catchBlocked: () => speak(THING.catch.blocked),
  eggSeen: () => speak(THING.egg.seen),
  eggPickup: () => speak(THING.egg.pickup),
  eggSetDown: () => speak(THING.egg.setDown),
  eggForcedDrop: () => speak(THING.egg.forcedDrop),
  eggLow: () => speak(THING.egg.lowSecurity),
  towerApproach: () => speak(THING.tower.approach),
  towerDeposit: () => speak(THING.tower.deposit),
  towerFewClues: (n: number, total: number) => speak(THING.tower.fewClues, { n, total }),
  accusePrompt: () => speak(THING.accusation.prompt),
  searchStart: () => speak(THING.search.start),
  /** V hint (deterministic, objective-first; the Phase 4 prescriptive service will supply real advice). */
  hint: (o: Objective, k: number, caseDef?: CaseDef): SpokenLine => {
    const obj = thing.objective(o, caseDef);
    const hints = THING.hints.map((l) => (l.id === 'hint_where' && caseDef ? { id: l.id, text: caseDef.thing.whereHint, pose: l.pose } : speak(l)));
    const pool = obj ? [obj, ...hints] : hints;
    return pool[k % pool.length]!;
  },
  result: (verdict: Verdict) => speak(THING.results[verdict]),
  dnf: (reason: DnfReason) => speak(THING.dnf[reason]),
  idle: () => speak(THING.idle),
};

export type TutorialStepLine = SpokenLine & { step: TutorialLine['step']; keys: string };

export function tutorialLines(vars: ThingVars): TutorialStepLine[] {
  return THING.tutorial.map((l) => ({ ...speak(l, vars), step: l.step, keys: l.keys }));
}

