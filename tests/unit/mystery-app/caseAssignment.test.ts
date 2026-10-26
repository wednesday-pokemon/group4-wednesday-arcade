// LOCAL DEMO case assignment: shuffled bag, one case per session, no reroll by refreshing, closed sessions stay closed.
import { describe, expect, it } from 'vitest';
import { CASE_BAG_KEY, drawCase, freshBag, readBag } from '../../../src/app/mystery/caseBag.ts';
import { openSession, readSession, SESSION_KEY, withClosed, writeSession, type SessionDeps } from '../../../src/app/mystery/session.ts';
import { draftOffer } from '../../../src/mystery/draft.ts';
import { CASE_IDS, type CaseId } from '../../../src/mystery/types.ts';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

/** Deterministic "crypto" bytes from a tiny LCG. */
function bytes(seed = 1) {
  let x = seed;
  return (n: number) => Uint8Array.from({ length: n }, () => {
    x = (x * 1103515245 + 12345) >>> 0;
    return (x >>> 16) & 0xff;
  });
}

function deps(storage: MemStorage, seed = 1): SessionDeps {
  const rb = bytes(seed);
  return {
    storage, randomBytes: rb, now: () => new Date('2026-10-31T20:00:00Z'), makeOffer: (s) => ({ offer: draftOffer(s), source: 'draft' }),
    realDraft: true, drawCase: () => drawCase(storage, rb),
  };
}

describe('shuffled case bag', () => {
  it('every block of three deals each case exactly once', () => {
    const st = new MemStorage();
    const rb = bytes(7);
    const dealt: CaseId[] = [];
    for (let i = 0; i < 30; i++) dealt.push(drawCase(st, rb));
    for (let b = 0; b < 30; b += 3) expect(new Set(dealt.slice(b, b + 3)).size).toBe(3);
    for (const id of CASE_IDS) expect(dealt.filter((d) => d === id)).toHaveLength(10);
  });

  it('a refill never deals the same case twice in a row', () => {
    for (let seed = 1; seed < 200; seed++) {
      const st = new MemStorage();
      const rb = bytes(seed);
      let prev: CaseId | null = null;
      for (let i = 0; i < 9; i++) {
        const c = drawCase(st, rb);
        expect(c).not.toBe(prev);
        prev = c;
      }
    }
  });

  it('freshBag is a permutation and honours `last`', () => {
    for (let seed = 1; seed < 100; seed++) {
      const bag = freshBag('midnight_signal', bytes(seed));
      expect([...bag].sort()).toEqual([...CASE_IDS].sort());
      expect(bag[0]).not.toBe('midnight_signal');
    }
  });

  it('a tampered bag is sanitised', () => {
    const st = new MemStorage();
    st.setItem(CASE_BAG_KEY, JSON.stringify({ bag: ['poisoned_archive', 'nope', 'poisoned_archive'], last: 'zzz' }));
    expect(readBag(st)).toEqual({ bag: ['poisoned_archive'], last: null });
  });
});

describe('one case per session', () => {
  it('a refresh restores the SAME case; the bag is not touched again', () => {
    const st = new MemStorage();
    const first = openSession(deps(st, 3)).session;
    const bagAfter = st.getItem(CASE_BAG_KEY);
    for (let i = 0; i < 5; i++) {
      const again = openSession(deps(st, 100 + i)).session;
      expect(again.sessionId).toBe(first.sessionId);
      expect(again.caseId).toBe(first.caseId);
    }
    expect(st.getItem(CASE_BAG_KEY)).toBe(bagAfter);
  });

  it('consecutive sessions on one kiosk cycle through all three cases', () => {
    const st = new MemStorage();
    const seen = new Set<CaseId>();
    for (let i = 0; i < 3; i++) {
      const s = openSession(deps(st, 11)).session;
      seen.add(s.caseId);
      writeSession(st, withClosed(s));
    }
    expect(seen.size).toBe(3);
  });

  it('a closed session (run ended) is never resumed: the next visitor gets a new session and the next case', () => {
    const st = new MemStorage();
    const s = openSession(deps(st)).session;
    writeSession(st, withClosed(s));
    expect(readSession(st)).toBeNull();
    const next = openSession(deps(st)).session;
    expect(next.sessionId).not.toBe(s.sessionId);
    expect(next.caseId).not.toBe(s.caseId);
  });

  it('sessions without a case, for an unknown case or an old case version are stale', () => {
    const st = new MemStorage();
    const s = openSession(deps(st)).session;
    for (const patch of [{ caseId: undefined }, { caseId: 'silent_evidence' }, { caseVersion: s.caseVersion + 1 }]) {
      st.setItem(SESSION_KEY, JSON.stringify({ ...s, ...patch }));
      expect(readSession(st)).toBeNull();
    }
  });
});
