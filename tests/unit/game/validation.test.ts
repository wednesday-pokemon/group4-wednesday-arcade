import { describe, expect, it } from 'vitest';
import {
  isCharacterId, isEggDecision, isLegIndex, isPokemonId, isPushLevel, isRouteId, isStationId, sanitizeNickname,
} from '../../../src/game/index.ts';

describe('sanitizeNickname', () => {
  it('trims, collapses spaces, strips control and markup characters', () => {
    expect(sanitizeNickname('  Raven   Queen ')).toEqual({ ok: true, value: 'Raven Queen' });
    expect(sanitizeNickname('<b>Nev</b>')).toEqual({ ok: true, value: 'bNev/b' });
    expect(sanitizeNickname('a"b\'c`d&e')).toEqual({ ok: true, value: 'abcde' });
    expect(sanitizeNickname('Tab\tName\n')).toEqual({ ok: true, value: 'Tab Name' });
    expect(sanitizeNickname('Ze\u0000ro​')).toEqual({ ok: true, value: 'Zero' });
  });
  it('enforces length 3-15 after sanitizing', () => {
    expect(sanitizeNickname('ab').ok).toBe(false);
    expect(sanitizeNickname(' <>a b ').ok).toBe(true);
    expect(sanitizeNickname('<<a>>').ok).toBe(false);
    expect(sanitizeNickname('x'.repeat(15))).toEqual({ ok: true, value: 'x'.repeat(15) });
    expect(sanitizeNickname('x'.repeat(16)).ok).toBe(false);
    expect(sanitizeNickname(42 as never).ok).toBe(false);
  });
});

describe('type guards', () => {
  it('ids and enums', () => {
    expect(isCharacterId('wednesday')).toBe(true);
    expect(isCharacterId('hyde')).toBe(false);
    expect(isPokemonId('alolan_marowak')).toBe(true);
    expect(isPokemonId('pikachu')).toBe(false);
    expect(isRouteId('safe') && isRouteId('shortcut') && !isRouteId('river')).toBe(true);
    expect(isPushLevel(1) && isPushLevel(3) && !isPushLevel(0) && !isPushLevel('2')).toBe(true);
    expect(isEggDecision('collect') && isEggDecision('skip') && !isEggDecision('take')).toBe(true);
    expect(isLegIndex(2) && !isLegIndex(4)).toBe(true);
    expect(isStationId('station_a') && !isStationId('local')).toBe(true);
  });
});
