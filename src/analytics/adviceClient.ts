// Main-thread client for the advisor worker with caching and a bounded-latency fallback.
import type { Advice, GameState, LegView } from '../game/index.ts';
import { adviceStateKey, adviseEgg, adviseRoute, type AdvisorOptions } from './advisor.ts';

export interface AdviceRequest { id: number; kind: Advice['kind']; state: GameState; view: LegView; options: AdvisorOptions }
export type AdviceResponse = { id: number; ok: true; advice: Advice } | { id: number; ok: false; message: string };

const WORKER_TIMEOUT_MS = 4000;
const FALLBACK_ROLLOUTS = 48;
const CACHE_LIMIT = 64;

const cache = new Map<string, Advice>();
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: AdviceResponse) => void>();

function getWorker(): Worker | null {
  if (worker || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./advisor.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AdviceResponse>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  } catch {
    worker = null;
  }
  return worker;
}

function remember(key: string, advice: Advice): Advice {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, advice);
  return advice;
}

/** Quick main-thread estimate used when the worker is unavailable or too slow; clearly flagged as approximate. */
function quickAdvice(kind: Advice['kind'], state: GameState, view: LegView): Advice {
  const options = { rollouts: FALLBACK_ROLLOUTS, timeBudgetMs: 250 };
  const advice = kind === 'route' ? adviseRoute(state, view, options) : adviseEgg(state, view, options);
  return { ...advice, warning: [advice.warning, `Quick estimate (${advice.rolloutsPerCandidate} simulations per option).`].filter(Boolean).join(' ') };
}

export async function requestAdvice(kind: Advice['kind'], state: GameState, view: LegView, options: AdvisorOptions = {}): Promise<Advice> {
  const key = `${kind}|${adviceStateKey(state, view)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const w = getWorker();
  if (!w) return remember(key, quickAdvice(kind, state, view));
  const id = nextId++;
  const response = await new Promise<AdviceResponse | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, WORKER_TIMEOUT_MS);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    w.postMessage({ id, kind, state, view, options } satisfies AdviceRequest);
  });
  if (response?.ok) return remember(key, response.advice);
  return remember(key, quickAdvice(kind, state, view));
}
