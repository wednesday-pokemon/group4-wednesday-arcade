// Thing's subtitle lines: the app-side resolver over the game-designer's script (src/mystery/data/thing.ts).
// Rules (plan §9): short, non-blocking, never names or hints at the culprit, never claims to compute analytics.
import { formatThingLine, THING, THING_STAY_SILENT, type ThingLine, type ThingPose, type TutorialLine } from '../../mystery/data/thing.ts';
import type { ClueId, DnfReason, HydeMode, Objective, Verdict } from '../../mystery/types.ts';

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
}

function speak(l: ThingLine, vars: ThingVars = {}): SpokenLine {
  const v: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(vars)) if (val !== undefined) v[k] = val;
  return { id: l.id, text: formatThingLine(l.text, v), pose: l.pose };
}

export const thing = {
  welcome: (): SpokenLine[] => THING.welcome.map((l) => speak(l)),
  duoIntro: (vars: ThingVars) => speak(THING.duoIntro, vars),
  objective: (o: Objective): SpokenLine | null => (o === 'done' ? null : speak(THING.objective[o])),
  clueFound: (id: ClueId) => speak(THING.clueFound[id]),
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
  towerFewClues: (n: number) => speak(THING.tower.fewClues, { n }),
  accusePrompt: () => speak(THING.accusation.prompt),
  searchStart: () => speak(THING.search.start),
  /** V hint (deterministic, objective-first; the Phase 4 prescriptive service will supply real advice). */
  hint: (o: Objective, k: number): SpokenLine => {
    const obj = o === 'done' ? null : THING.objective[o];
    const pool = obj ? [obj, ...THING.hints] : THING.hints;
    return speak(pool[k % pool.length]!);
  },
  result: (verdict: Verdict) => speak(THING.results[verdict]),
  dnf: (reason: DnfReason) => speak(THING.dnf[reason]),
  idle: () => speak(THING.idle),
};

export type TutorialStepLine = SpokenLine & { step: TutorialLine['step']; keys: string };

export function tutorialLines(vars: ThingVars): TutorialStepLine[] {
  return THING.tutorial.map((l) => ({ ...speak(l, vars), step: l.step, keys: l.keys }));
}

export function clueTitleFallback(id: ClueId): string {
  return { transfer_note: 'Restricted-transfer note', master_key: 'Master-key evidence', greenhouse_trace: 'Greenhouse trace' }[id];
}
