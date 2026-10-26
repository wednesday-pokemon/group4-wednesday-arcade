// Input validation and sanitization shared by the browser, Edge Functions and tests. Pure; no DOM/Node APIs.
import { CHARACTERS, NICKNAME, POKEMON } from './constants.ts';
import type { CharacterId, EggDecision, LegIndex, PokemonId, PushLevel, RouteId, StationId } from './types.ts';

const CHARACTER_IDS: ReadonlySet<string> = new Set(CHARACTERS.map((c) => c.id));
const POKEMON_IDS: ReadonlySet<string> = new Set(POKEMON.map((p) => p.id));

// C0/C1 control characters, DEL, zero-width/bidi format characters, and markup-significant characters.
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿<>&"'`]/g;

/** Trim, collapse whitespace runs to one space, strip control/markup chars <>&"'`, require 3–15 characters. */
export function sanitizeNickname(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'Nickname must be text' };
  const value = raw
    .replace(/\s+/g, ' ') // tabs/newlines become spaces before control stripping
    .replace(STRIP_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  const length = Array.from(value).length;
  if (length < NICKNAME.minLength) {
    return { ok: false, message: `Nickname must be at least ${NICKNAME.minLength} characters` };
  }
  if (length > NICKNAME.maxLength) {
    return { ok: false, message: `Nickname must be at most ${NICKNAME.maxLength} characters` };
  }
  return { ok: true, value };
}

export function isCharacterId(x: unknown): x is CharacterId {
  return typeof x === 'string' && CHARACTER_IDS.has(x);
}

export function isPokemonId(x: unknown): x is PokemonId {
  return typeof x === 'string' && POKEMON_IDS.has(x);
}

export function isRouteId(x: unknown): x is RouteId {
  return x === 'safe' || x === 'shortcut';
}

export function isPushLevel(x: unknown): x is PushLevel {
  return x === 1 || x === 2 || x === 3;
}

export function isEggDecision(x: unknown): x is EggDecision {
  return x === 'collect' || x === 'skip';
}

export function isLegIndex(x: unknown): x is LegIndex {
  return x === 1 || x === 2 || x === 3;
}

export function isStationId(x: unknown): x is StationId {
  return x === 'station_a' || x === 'station_b';
}
