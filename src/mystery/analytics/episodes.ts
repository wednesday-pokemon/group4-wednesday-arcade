// Seeded simulated episodes with full telemetry, for data generation, evaluation and tests.
// NODE / TEST ONLY: it imports the answer keys (data/solutions.ts) to commit the bot's accusation, so browser code must
// never import this module (src/mystery/analytics/index.ts does not).
// The loop is a step-for-step mirror of `playEpisode` (src/mystery/episode.ts) — same decision cadence, same 1 Hz snapshot
// timing (taken BEFORE each step at t = 0, 1, 2, …) — so (duo, seed, options) yields exactly the same episode; a test
// asserts the logs are identical. In addition it records each snapshot's perceivable LiveContext, the walked distance
// and lets a hook observe the live run (read-only) at every sample, e.g. to ask the PrescriptiveService for advice.
import { Bot, type BotOptions } from '../bot.ts';
import { episodeCase } from '../episode.ts';
import { MysteryRun, type MysteryRunOptions } from '../run.ts';
import type { Duo, RunResult } from '../types.ts';
import { duoFactorsFromRun, liveContext, type LiveContextOptions } from './state.ts';
import { TelemetryCollector } from './telemetry.ts';
import type { TelemetrySample } from './types.ts';

export interface EpisodeHooks {
  /** Called at every 1 Hz sample with the live run (do not mutate it). */
  onSample?(run: MysteryRun, sample: TelemetrySample, collector: TelemetryCollector): void;
  /** Called after every fixed sim step with the live run (do not mutate it) — evaluation scripts record trajectories. */
  onStep?(run: MysteryRun): void;
  context?: LiveContextOptions;
}

export interface SimEpisode {
  duo: Duo;
  seed: string;
  options: BotOptions;
  run: MysteryRun;
  collector: TelemetryCollector;
  result: RunResult | null;
  timedOut: boolean;
}

export function simulateEpisode(
  duo: Duo, seed: string, options: BotOptions, hooks: EpisodeHooks = {}, runOptions: Partial<MysteryRunOptions> = {},
): SimEpisode {
  const kase = episodeCase(seed, runOptions.caseDef);
  const run = new MysteryRun({ ...runOptions, caseDef: kase.caseDef, duo, seed, tutorial: false });
  const bot = new Bot(run, options, seed);
  const collector = new TelemetryCollector({
    sessionId: seed, stationId: null, caseId: run.caseDef.id, caseVersion: run.caseDef.version, duo: { ...duo }, factors: duoFactorsFromRun(run),
  });
  const dt = run.tuning.fixedStepS;
  const decideEvery = Math.max(1, Math.round(1 / (bot.o.decisionHz * dt)));
  let nextSnap = 0;
  let step = 0;
  let input = bot.decide();
  collector.trackPosition(run.player.x, run.player.z);
  while (run.status === 'playing' && run.t < bot.o.maxTimeS) {
    if (step % decideEvery === 0) {
      input = bot.decide();
      run.applyLook(input);
      run.setInput(input);
    }
    if (run.t >= nextSnap) {
      collector.syncFromLog(run.log);
      const sample: TelemetrySample = { snapshot: run.snapshot(), context: liveContext(run, hooks.context) };
      collector.addSample(sample);
      hooks.onSample?.(run, sample, collector);
      nextSnap += 1;
    }
    run.step(dt);
    hooks.onStep?.(run);
    collector.trackPosition(run.player.x, run.player.z);
    input = { ...input, interact: false, power: false, move: false, hint: false };
    run.setInput(input);
    step++;
  }
  if (run.status === 'accusing') run.accuse(bot.accusation(), kase.solution);
  collector.syncFromLog(run.log);
  const result = run.result();
  collector.setResult(result);
  return { duo: { ...duo }, seed, options, run, collector, result, timedOut: run.status === 'playing' };
}
