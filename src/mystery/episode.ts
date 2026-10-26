// Headless episode driver (tests, the analytics generator, the integration fake): a MysteryRun played by the Bot from
// the pier to the accusation. Node/test only — it imports the answer keys, so browser code must never import it.
import { Bot, type BotOptions, type BotProfile } from './bot.ts';
import { sessionCaseDef, withClueContent } from './caseVariant.ts';
import { CASE_VARIANTS } from './data/solutions.ts';
import { defaultCase } from './defaults.ts';
import { prfUniform } from './prf.ts';
import { MysteryRun, type MysteryRunOptions } from './run.ts';
import { SUSPECT_IDS } from './types.ts';
import type { CaseDef, CaseSolution, Duo, RunResult, StampedEvent, StateSnapshot, SuspectId } from './types.ts';

/** Headless episodes draw their murderer from the seed (offline only: a LIVE session's murderer is drawn server-side). */
export function episodeCulprit(seed: string): SuspectId {
  return SUSPECT_IDS[Math.min(SUSPECT_IDS.length - 1, Math.floor(prfUniform(seed, 'episode:culprit') * SUSPECT_IDS.length))];
}

/**
 * The scenario a headless episode plays: the session case (seeded suspect order) with the murderer's clue texts already
 * merged (the bot only reads FOUND clues, so this matches the reveal-on-find app) + the matching answer key.
 */
export function episodeCase(seed: string, base: CaseDef = defaultCase(), culprit: SuspectId = episodeCulprit(seed)): { caseDef: CaseDef; solution: CaseSolution } {
  const v = CASE_VARIANTS[base.id][culprit];
  return { caseDef: withClueContent(sessionCaseDef(base, seed), v.clues), solution: v.solution };
}

export interface BotEpisode {
  duo: Duo;
  seed: string;
  profile: BotProfile;
  result: RunResult | null;
  timedOut: boolean;
  activeTimeS: number;
  events: StampedEvent[];
  snapshots: StateSnapshot[];
  run: MysteryRun;
}

/**
 * Plays one full episode headless. `runOptions` may override map / case / tuning / registries; `culprit` pins the
 * murderer (regression pins replay the pre-randomization culprits), else it is drawn from the seed.
 */
export function playEpisode(
  duo: Duo, seed: string, options: BotOptions, runOptions: Partial<MysteryRunOptions> = {}, culprit?: SuspectId,
): BotEpisode {
  const kase = episodeCase(seed, runOptions.caseDef, culprit);
  const run = new MysteryRun({ ...runOptions, caseDef: kase.caseDef, duo, seed, tutorial: false });
  const bot = new Bot(run, options, seed);
  const dt = run.tuning.fixedStepS;
  const decideEvery = Math.max(1, Math.round(1 / (bot.o.decisionHz * dt)));
  const snapshots: StateSnapshot[] = [];
  let nextSnap = 0;
  let step = 0;
  let input = bot.decide();
  while (run.status === 'playing' && run.t < bot.o.maxTimeS) {
    if (step % decideEvery === 0) {
      input = bot.decide();
      run.applyLook(input);
      run.setInput(input);
    }
    if (run.t >= nextSnap) {
      snapshots.push(run.snapshot());
      nextSnap += 1;
    }
    run.step(dt);
    // edges are consumed by the step; keep held inputs only
    input = { ...input, interact: false, power: false, move: false, hint: false };
    run.setInput(input);
    step++;
  }
  if (run.status === 'accusing') run.accuse(bot.accusation(), kase.solution);
  return {
    duo, seed, profile: options.profile, result: run.result(), timedOut: run.status === 'playing', activeTimeS: run.activeTimeS(),
    events: run.log, snapshots, run,
  };
}
