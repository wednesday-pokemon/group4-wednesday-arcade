// Headless episode driver (tests, the analytics generator, the integration fake): a MysteryRun played by the Bot from
// the pier to the accusation. Node/test only — it imports the answer keys, so browser code must never import it.
import { Bot, type BotOptions, type BotProfile } from './bot.ts';
import { CASE_SOLUTIONS } from './data/solutions.ts';
import { MysteryRun, type MysteryRunOptions } from './run.ts';
import type { Duo, RunResult, StampedEvent, StateSnapshot } from './types.ts';

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

/** Plays one full episode headless. `runOptions` may override map / case / tuning / registries. */
export function playEpisode(
  duo: Duo, seed: string, options: BotOptions, runOptions: Partial<MysteryRunOptions> = {},
): BotEpisode {
  const run = new MysteryRun({ ...runOptions, duo, seed, tutorial: false });
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
  if (run.status === 'accusing') run.accuse(bot.accusation(), CASE_SOLUTIONS[run.caseDef.id]);
  return {
    duo, seed, profile: options.profile, result: run.result(), timedOut: run.status === 'playing', activeTimeS: run.activeTimeS(),
    events: run.log, snapshots, run,
  };
}
