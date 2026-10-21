import { describe, expect, it } from 'vitest';
import {
  clearSession, createSession, newSeed, newSessionId, openSession, readSession, resetSession, SESSION_KEY, withSelected,
  writeSession, type SessionDeps,
} from '../../../src/app/mystery/session.ts';
import { draftOffer as previewOffer } from '../../../src/mystery/draft.ts';
import type { DuoOffer } from '../../../src/mystery/types.ts';

class MemStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** Deterministic "crypto": counter bytes. */
function counterBytes() {
  let n = 0;
  return (len: number) => Uint8Array.from({ length: len }, () => n++ & 0xff);
}

function deps(storage: MemStorage | null, extra: Partial<SessionDeps> = {}): SessionDeps & { offers: string[] } {
  const offers: string[] = [];
  return {
    storage,
    randomBytes: counterBytes(),
    now: () => new Date('2026-10-27T10:00:00Z'),
    makeOffer: (seed) => {
      offers.push(seed);
      return { offer: previewOffer(seed), source: 'preview' };
    },
    realDraft: false,
    offers,
    ...extra,
  };
}

describe('mystery session ids', () => {
  it('seed is 128-bit hex and session id is a v4 UUID', () => {
    const rb = counterBytes();
    expect(newSeed(rb)).toMatch(/^[0-9a-f]{32}$/);
    expect(newSessionId(rb)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('openSession', () => {
  it('creates and persists a session only when none is open', () => {
    const st = new MemStorage();
    const d = deps(st);
    const a = openSession(d);
    expect(a.restored).toBe(false);
    expect(st.getItem(SESSION_KEY)).not.toBeNull();
    const b = openSession(d);
    expect(b.restored).toBe(true);
    expect(b.session.sessionId).toBe(a.session.sessionId);
    expect(d.offers).toHaveLength(1); // the offer was drawn once
  });

  it('a refresh (new deps, same storage) restores the SAME offer', () => {
    const st = new MemStorage();
    const first = openSession(deps(st)).session;
    const again = openSession(deps(st, { randomBytes: () => new Uint8Array(16).fill(7) })).session;
    expect(again.seed).toBe(first.seed);
    expect(again.offer).toEqual(first.offer);
  });

  it('keeps nickname + selection across refreshes', () => {
    const st = new MemStorage();
    const s = openSession(deps(st)).session;
    const card = s.offer.cards[1];
    writeSession(st, withSelected({ ...s, nickname: 'Raven' }, card));
    const r = readSession(st)!;
    expect(r.nickname).toBe('Raven');
    expect(r.selected).toEqual({ characterId: card.characterId, pokemonId: card.pokemonId });
  });

  it('resetSession (Play again) clears it and draws a new seed/offer', () => {
    const st = new MemStorage();
    const d = deps(st);
    const a = openSession(d).session;
    const b = resetSession(d);
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(b.seed).not.toBe(a.seed);
    expect(readSession(st)?.sessionId).toBe(b.sessionId);
  });

  it('upgrades a preview offer to the real draft for the same seed, dropping a preview selection', () => {
    const st = new MemStorage();
    const s = openSession(deps(st)).session;
    writeSession(st, withSelected(s, s.offer.cards[0]));
    const real: DuoOffer = { ...previewOffer('x'), seed: s.seed };
    const up = openSession(deps(st, { realDraft: true, makeOffer: () => ({ offer: real, source: 'draft' }) })).session;
    expect(up.sessionId).toBe(s.sessionId);
    expect(up.offerSource).toBe('draft');
    expect(up.offer).toEqual(real);
    expect(up.selected).toBeUndefined();
    // and a real offer is never regenerated afterwards
    const again = openSession(deps(st, { realDraft: true, makeOffer: () => { throw new Error('must not redraw'); } })).session;
    expect(again.offer).toEqual(real);
  });

  it('treats malformed / foreign-version storage as no open session', () => {
    const st = new MemStorage();
    st.setItem(SESSION_KEY, '{not json');
    expect(readSession(st)).toBeNull();
    st.setItem(SESSION_KEY, JSON.stringify({ rulesVersion: 'v3.0-realtime', sessionId: 'a', seed: 's', nickname: '', offer: previewOffer('s') }));
    expect(readSession(st)).toBeNull();
    st.setItem(SESSION_KEY, JSON.stringify({ rulesVersion: 'mystery-v3.1', sessionId: 'a', seed: 'other', nickname: '', offer: previewOffer('s') }));
    expect(readSession(st)).toBeNull(); // offer seed must match the session seed
    expect(openSession(deps(st)).restored).toBe(false);
  });

  it('works without storage (private mode): in-memory only', () => {
    const d = deps(null);
    const a = openSession(d);
    expect(a.restored).toBe(false);
    clearSession(null);
    expect(createSession(d).offer.cards).toHaveLength(3);
  });
});

describe('withSelected', () => {
  it('only accepts one of the three offered duos', () => {
    const s = createSession(deps(new MemStorage()));
    const offered = s.offer.cards.map((c) => c.characterId);
    const notOffered = (['wednesday', 'morticia', 'enid', 'bianca', 'eugene', 'gomez', 'ajax'] as const).find((c) => !offered.includes(c))!;
    expect(withSelected(s, { characterId: notOffered, pokemonId: 'gengar' }).selected).toBeUndefined();
    expect(withSelected(s, s.offer.cards[2]).selected?.characterId).toBe(s.offer.cards[2].characterId);
  });
});

describe('draftOffer (as used by the session)', () => {
  it('is deterministic per seed with distinct characters and Pokémon', () => {
    const a = previewOffer('seed-1');
    expect(previewOffer('seed-1')).toEqual(a);
    expect(new Set(a.cards.map((c) => c.characterId)).size).toBe(3);
    expect(new Set(a.cards.map((c) => c.pokemonId)).size).toBe(3);
    expect(previewOffer('seed-2')).not.toEqual(a);
  });
});
