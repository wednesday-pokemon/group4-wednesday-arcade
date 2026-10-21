// Realtime channel lifecycle shared by the dashboard feed and the terminal's station watch:
// unique channel topics, status -> ConnectionState, re-create with backoff after CHANNEL_ERROR / TIMED_OUT /
// CLOSED (supabase-js also rejoins on its own; whichever SUBSCRIBED comes first wins), and a hook that runs
// after EVERY SUBSCRIBED so callers refetch whatever they may have missed while disconnected.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { ConnectionState } from '../backend.ts';

export type RealtimeHost = Pick<SupabaseClient, 'channel' | 'removeChannel'>;
export type ChannelPhase = 'connecting' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

export interface OnlineSource {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export const browserOnline: OnlineSource = {
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  subscribe(listener) {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => undefined;
    const on = () => listener(true);
    const off = () => listener(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  },
};

export function connectionFrom(online: boolean, phase: ChannelPhase | null): ConnectionState {
  if (!online) return 'offline';
  if (phase === 'SUBSCRIBED') return 'connected';
  if (phase === 'connecting' || phase === null) return 'connecting';
  return 'offline';
}

export interface ManagedChannelOptions {
  topic: string;
  /** Registers the `.on(...)` handlers; must return the same channel. */
  bind(channel: RealtimeChannel): RealtimeChannel;
  onPhase(phase: ChannelPhase): void;
  /** Runs after every SUBSCRIBED (first join and every rejoin). */
  onSubscribed(): void;
  retryDelaysMs?: number[];
}

export interface ManagedChannel {
  /** Re-create the channel now unless it is currently subscribed (e.g. the browser came back online). */
  kick(): void;
  stop(): void;
}

let topicCounter = 0;

export function openManagedChannel(host: RealtimeHost, opts: ManagedChannelOptions): ManagedChannel {
  const delays = opts.retryDelaysMs ?? [2000, 5000, 10_000, 20_000, 30_000];
  let current: RealtimeChannel | null = null;
  let phase: ChannelPhase = 'connecting';
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const setPhase = (next: ChannelPhase) => {
    phase = next;
    opts.onPhase(next);
  };

  function create(): void {
    const channel = opts.bind(host.channel(`${opts.topic}:${++topicCounter}`));
    current = channel;
    setPhase('connecting');
    channel.subscribe((status) => {
      if (stopped || channel !== current) return; // late callback from a removed channel
      if (status === 'SUBSCRIBED') {
        failures = 0;
        clearTimer();
        setPhase('SUBSCRIBED');
        opts.onSubscribed();
        return;
      }
      setPhase(status);
      if (timer === null) {
        const delay = delays[Math.min(failures, delays.length - 1)];
        failures++;
        timer = setTimeout(() => {
          timer = null;
          if (!stopped && phase !== 'SUBSCRIBED') recreate();
        }, delay);
      }
    });
  }

  function recreate(): void {
    const old = current;
    current = null;
    if (old) void host.removeChannel(old).catch(() => undefined);
    create();
  }

  create();
  return {
    kick() {
      if (stopped || phase === 'SUBSCRIBED') return;
      clearTimer();
      recreate();
    },
    stop() {
      stopped = true;
      clearTimer();
      const old = current;
      current = null;
      if (old) void host.removeChannel(old).catch(() => undefined);
    },
  };
}
