// Diagnostic layer — Wednesday's post-race autopsy. Additive waterfall in centiseconds that reconstructs
// the leg time exactly, plus plain-language explanations.
import { formatSeconds } from '../game/index.ts';
import type { LegResolution, TimeBreakdown } from '../game/index.ts';

export interface WaterfallStep {
  key: 'base' | 'savings' | 'weather' | 'crash' | 'egg' | 'hyde' | 'floor' | 'total';
  label: string;
  deltaCs: number; // signed contribution; for 'base' and 'total' the absolute value
  runningCs: number; // cumulative after this step
}

export function buildWaterfall(t: TimeBreakdown): WaterfallStep[] {
  const parts: Omit<WaterfallStep, 'runningCs'>[] = [
    { key: 'base', label: 'Route base time', deltaCs: t.baseCs },
    { key: 'savings', label: `Speed savings (${t.discountPct}%)`, deltaCs: -t.speedSavingsCs },
    { key: 'weather', label: 'Weather delay', deltaCs: t.weatherDelayCs },
    { key: 'crash', label: 'Crash delay', deltaCs: t.crashDelayCs },
    { key: 'egg', label: 'Egg collection', deltaCs: t.eggDelayCs },
    { key: 'hyde', label: 'Hyde catch delay', deltaCs: t.hydeDelayCs },
    { key: 'floor', label: '10 s minimum adjustment', deltaCs: t.floorAdjustmentCs },
  ];
  let running = 0;
  const steps = parts
    .filter((p) => p.key === 'base' || p.key === 'savings' || p.deltaCs !== 0)
    .map((p) => {
      running += p.deltaCs;
      return { ...p, runningCs: running };
    });
  if (running !== t.totalCs) throw new Error(`Waterfall mismatch: ${running} != ${t.totalCs}`);
  return [...steps, { key: 'total', label: 'Leg time', deltaCs: t.totalCs, runningCs: t.totalCs }];
}

const s = (cs: number) => `${formatSeconds(Math.abs(cs))} s`;

/** Plain-English "why" statements for one leg, ordered by impact. */
export function explainLeg(r: LegResolution): string[] {
  const t = r.time;
  const lines: { impact: number; text: string }[] = [];
  const sources = t.discountSources.map((d) => `${d.source} ${d.pct}%`).join(', ');
  lines.push({ impact: t.speedSavingsCs, text: `Speed boosts saved ${s(t.speedSavingsCs)} (${sources || 'none'}).` });
  if (t.weatherDelayCs > 0) lines.push({ impact: t.weatherDelayCs, text: `The weather cost you ${s(t.weatherDelayCs)}.` });
  if (r.crashOccurred && r.crashNegatedBy) lines.push({ impact: 1, text: `You crashed, but ${r.crashNegatedBy} shrugged off the damage.` });
  if (t.crashDelayCs > 0) lines.push({ impact: t.crashDelayCs, text: `The crash added ${s(t.crashDelayCs)}.` });
  if (t.eggDelayCs > 0) {
    lines.push({ impact: t.eggDelayCs, text: r.eggFailed ? `Grabbing the egg took ${s(t.eggDelayCs)}, but it slipped away in the crash.` : `Grabbing the egg took ${s(t.eggDelayCs)}.` });
  }
  if (t.hydeDelayCs > 0) lines.push({ impact: t.hydeDelayCs, text: `Escaping Hyde's grip cost ${s(t.hydeDelayCs)}.` });
  if (t.floorAdjustmentCs > 0) lines.push({ impact: t.floorAdjustmentCs, text: 'No leg can be faster than 10 s, so the time was raised to the minimum.' });
  return lines.sort((a, b) => b.impact - a.impact).map((l) => l.text);
}

export interface RaceAutopsy {
  totalCs: number;
  biggestDelay: { label: string; cs: number } | null;
  totalSavingsCs: number;
  delaysByKind: Record<'weather' | 'crash' | 'egg' | 'hyde', number>;
}

export function buildRaceAutopsy(results: LegResolution[]): RaceAutopsy {
  const delaysByKind = { weather: 0, crash: 0, egg: 0, hyde: 0 };
  let totalSavingsCs = 0;
  let totalCs = 0;
  for (const r of results) {
    delaysByKind.weather += r.time.weatherDelayCs;
    delaysByKind.crash += r.time.crashDelayCs;
    delaysByKind.egg += r.time.eggDelayCs;
    delaysByKind.hyde += r.time.hydeDelayCs;
    totalSavingsCs += r.time.speedSavingsCs;
    totalCs += r.time.totalCs;
  }
  const labels = { weather: 'Weather', crash: 'Crashes', egg: 'Egg collection', hyde: 'Hyde catches' };
  const [kind, cs] = Object.entries(delaysByKind).sort((a, b) => b[1] - a[1])[0] as [keyof typeof labels, number];
  return { totalCs, totalSavingsCs, delaysByKind, biggestDelay: cs > 0 ? { label: labels[kind], cs } : null };
}
