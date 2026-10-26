import { describe, expect, it } from 'vitest';
import { RiskHold } from '../../../src/app/mystery/hudModel.ts';
import { appendRecord, LIVE_KEY, loadRecords, readLive, RECORDS_KEY, writeLive, type StoredRecord } from '../../../src/app/mystery/records.ts';
import { createMysteryAnalytics } from '../../../src/mystery/analytics/index.ts';
import { playEpisode } from '../../../src/mystery/episode.ts';
import type { StampedEvent } from '../../../src/mystery/types.ts';

class MemStorage {
  map = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const ev = (seq: number, e: Record<string, unknown>) => ({ t: seq, seq, ...e }) as unknown as StampedEvent;

function rec(id: string, events: StampedEvent[] = []): StoredRecord {
  return {
    record: { sessionId: id, duo: { characterId: 'enid', pokemonId: 'gengar' }, events, result: { outcome: 'finished', verdict: 'case_solved', activeTimeS: 100, score: 200, cluesFound: [], catches: 0 } },
    nickname: 'R', stationId: 'local', endedAt: '2026-10-27T10:00:00Z',
  };
}

describe('local dashboard records', () => {
  it('appends, replaces by sessionId and caps to the newest N', () => {
    const st = new MemStorage();
    for (let i = 0; i < 5; i++) appendRecord(st, rec(`s${i}`), 3);
    expect(loadRecords(st).map((r) => r.record.sessionId)).toEqual(['s2', 's3', 's4']);
    appendRecord(st, { ...rec('s3'), nickname: 'again' }, 3);
    const ids = loadRecords(st).map((r) => r.record.sessionId);
    expect(ids).toEqual(['s2', 's4', 's3']);
  });

  it('thins plain footsteps like the upload and redacts who was accused', () => {
    const st = new MemStorage();
    appendRecord(st, rec('x', [
      ev(1, { type: 'noise', source: 'footstep', x: 0, z: 0, loudness: 0.35, radiusM: 7 }),
      ev(2, { type: 'clue_found', clueId: 'access_ledger', cluesFound: 1 }),
      ev(3, { type: 'accusation', suspectId: 'isaac', correct: false, cluesFound: 1, evidence: ['access_ledger'], deductionCorrect: false }),
    ]));
    const [r] = loadRecords(st);
    expect(r!.record.events.map((e) => e.type)).toEqual(['clue_found', 'accusation']);
    expect(JSON.stringify(r)).not.toContain('isaac');
  });

  it('survives a storage quota by dropping the oldest records', () => {
    const st = new MemStorage();
    for (let i = 0; i < 8; i++) appendRecord(st, rec(`q${i}`));
    st.quota = (st.getItem(RECORDS_KEY)?.length ?? 0) - 10;
    const kept = appendRecord(st, rec('q8'));
    expect(kept.at(-1)!.record.sessionId).toBe('q8');
    expect(kept.length).toBeLessThan(9);
  });

  it('ignores corrupt storage', () => {
    const st = new MemStorage();
    st.setItem(RECORDS_KEY, '{bad');
    expect(loadRecords(st)).toEqual([]);
    st.setItem(LIVE_KEY, '{bad');
    expect(readLive(st)).toBeNull();
  });

  it('live status round-trips', () => {
    const st = new MemStorage();
    writeLive(st, { stationId: 'local', phase: 'investigating', nickname: 'R', duo: null, clues: 1, egg: null, hp: 100, catches: 0, hydeMode: 'PATROL', risk: { p: 0.2, label: 'ML estimate' }, advice: null, activeTimeS: 12, updatedAt: 1 });
    expect(readLive(st)?.phase).toBe('investigating');
  });

  it('a real bot episode produces a storable record with a result', () => {
    const ep = playEpisode({ characterId: 'ajax', pokemonId: 'gholdengo' }, 'records-test', { profile: 'stealthy', accuse: 'deduce' });
    const a = createMysteryAnalytics(ep.run, { sessionId: 'sess-1', stationId: 'local', offered: [{ characterId: 'ajax', pokemonId: 'gholdengo' }] });
    a.frame(ep.run, []);
    const st = new MemStorage();
    appendRecord(st, { record: a.sessionRecord(), nickname: 'Bot', stationId: 'local', endedAt: '2026-10-27T10:00:00Z' });
    const [r] = loadRecords(st);
    expect(r!.record.sessionId).toBe('sess-1');
    expect(r!.record.result?.outcome).toMatch(/finished|dnf/);
    expect(r!.record.events.length).toBeGreaterThan(5);
  });
});

describe('RiskHold (2 s band hold)', () => {
  const v = (band: 'low' | 'medium' | 'high', p: number) => ({ p, band, source: 'ml' as const, label: 'ML estimate', detectedNow: false });
  it('changes band at most every 2 s; values follow', () => {
    const h = new RiskHold();
    expect(h.update(v('low', 0.1), 0)?.band).toBe('low');
    expect(h.update(v('high', 0.8), 1)?.band).toBe('low');
    expect(h.update(v('high', 0.8), 1)?.p).toBe(0.8);
    expect(h.update(v('high', 0.8), 2.1)?.band).toBe('high');
    expect(h.update(v('medium', 0.5), 2.5)?.band).toBe('high');
    expect(h.update(null, 3)?.band).toBe('high');
  });
});
