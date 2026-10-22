// Visitor session persistence (MYSTERY_CONTRACT "App"): localStorage['raven.mystery.session'] holds
// { sessionId, seed, offer, caseId, caseVersion, selected?, closed?, nickname, createdAt }. A session (crypto seed →
// draftOffer(seed); case dealt from the shuffled case bag, independent of the seed) is created only when none is open;
// a refresh / re-render restores the SAME offer and the SAME case; a session whose run ended is CLOSED, so a refresh
// never re-opens a finished case (no second accusation). "Play again" clears it. Pure functions over an injected
// Storage + entropy so they are unit-testable in Node.
import { CASES, isCaseId } from '../../mystery/data/cases.ts';
import { MYSTERY_RULES_VERSION, NIGHTSHADE_IDS } from '../../mystery/types.ts';
import type { CaseId, Duo, DuoCard, DuoOffer, MysteryRulesVersion } from '../../mystery/types.ts';
import type { OfferSource } from './integration.ts';

export const SESSION_KEY = 'raven.mystery.session';

export interface MysterySession {
  rulesVersion: MysteryRulesVersion;
  sessionId: string;
  seed: string;
  offer: DuoOffer;
  /** 'preview' while src/mystery/draft.ts is missing; such offers are rebuilt from the same seed once it lands. */
  offerSource: OfferSource;
  /** The case assigned when the session was created (never chosen, never re-drawn for this session). */
  caseId: CaseId;
  caseVersion: number;
  selected?: Duo;
  /** The run ended (results reached): the session can no longer be resumed. */
  closed?: boolean;
  nickname: string;
  createdAt: string;
}

export interface SessionDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  randomBytes: (n: number) => Uint8Array;
  now: () => Date;
  makeOffer: (seed: string) => { offer: DuoOffer; source: OfferSource };
  /** True when the real draftOffer() is available (preview offers then get rebuilt). */
  realDraft: boolean;
  /** Deals the case for a NEW session (src/app/mystery/caseBag.ts drawCase). */
  drawCase: () => CaseId;
}

export function browserRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** 128-bit seed as 32 hex chars. */
export function newSeed(randomBytes: (n: number) => Uint8Array): string {
  return hex(randomBytes(16));
}

/** RFC 4122 v4 UUID from 16 random bytes (same format as crypto.randomUUID). */
export function newSessionId(randomBytes: (n: number) => Uint8Array): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function isDuo(v: unknown): v is Duo {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return typeof d.characterId === 'string' && (NIGHTSHADE_IDS as readonly string[]).includes(d.characterId) && typeof d.pokemonId === 'string';
}

function isOffer(v: unknown): v is DuoOffer {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.seed === 'string' && Array.isArray(o.cards) && o.cards.length === 3 && o.cards.every(isDuo);
}

/** Parses + validates the stored session; anything malformed or from another rules version counts as "none open". */
export function readSession(storage: SessionDeps['storage']): MysterySession | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<MysterySession>;
    if (s.rulesVersion !== MYSTERY_RULES_VERSION) return null;
    if (typeof s.sessionId !== 'string' || typeof s.seed !== 'string' || typeof s.nickname !== 'string') return null;
    if (!isOffer(s.offer) || s.offer.seed !== s.seed) return null;
    if (s.selected !== undefined && !isDuo(s.selected)) return null;
    // A session from before the case system, for an unknown case, or for an older version of its case is stale.
    if (!isCaseId(s.caseId) || s.caseVersion !== CASES[s.caseId].version) return null;
    if (s.closed === true) return null;
    return {
      rulesVersion: MYSTERY_RULES_VERSION,
      sessionId: s.sessionId,
      seed: s.seed,
      offer: s.offer,
      offerSource: s.offerSource === 'draft' ? 'draft' : 'preview',
      caseId: s.caseId,
      caseVersion: s.caseVersion,
      ...(s.selected ? { selected: s.selected } : {}),
      nickname: s.nickname,
      createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeSession(storage: SessionDeps['storage'], s: MysterySession): void {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // Storage full / disabled: the session still lives in memory for this page view.
  }
}

export function clearSession(storage: SessionDeps['storage']): void {
  try {
    storage?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** A brand-new session: fresh crypto seed + its offer. Not persisted until `openSession`/`writeSession`. */
export function createSession(deps: SessionDeps, opts: { seed?: string; nickname?: string; caseId?: CaseId } = {}): MysterySession {
  const seed = opts.seed ?? newSeed(deps.randomBytes);
  const { offer, source } = deps.makeOffer(seed);
  const caseId = opts.caseId ?? deps.drawCase();
  return {
    rulesVersion: MYSTERY_RULES_VERSION,
    sessionId: newSessionId(deps.randomBytes),
    seed,
    offer,
    offerSource: source,
    caseId,
    caseVersion: CASES[caseId].version,
    nickname: opts.nickname ?? '',
    createdAt: deps.now().toISOString(),
  };
}

/**
 * Restores the open session, or creates + persists a new one when none is open. A preview offer is upgraded to the
 * real draftOffer(seed) (same seed, same session) once the draft module exists; a real offer is never regenerated.
 */
export function openSession(deps: SessionDeps): { session: MysterySession; restored: boolean } {
  const existing = readSession(deps.storage);
  if (existing) {
    if (existing.offerSource === 'preview' && deps.realDraft) {
      const { offer, source } = deps.makeOffer(existing.seed);
      // A selection made from preview cards is dropped: the visitor picks again from the real cards.
      const upgraded: MysterySession = {
        rulesVersion: existing.rulesVersion, sessionId: existing.sessionId, seed: existing.seed, offer, offerSource: source,
        caseId: existing.caseId, caseVersion: existing.caseVersion, nickname: existing.nickname, createdAt: existing.createdAt,
      };
      writeSession(deps.storage, upgraded);
      return { session: upgraded, restored: true };
    }
    return { session: existing, restored: true };
  }
  const session = createSession(deps);
  writeSession(deps.storage, session);
  return { session, restored: false };
}

/** Clears the stored session and opens a new one (Play again / reset). */
export function resetSession(deps: SessionDeps): MysterySession {
  clearSession(deps.storage);
  return openSession(deps).session;
}

export function sameDuo(a: Duo | null | undefined, b: Duo | null | undefined): boolean {
  return !!a && !!b && a.characterId === b.characterId && a.pokemonId === b.pokemonId;
}

/** The selection is valid only when it is one of the three offered cards. */
export function offeredCard(offer: DuoOffer, duo: Duo): DuoCard | null {
  return offer.cards.find((c) => sameDuo(c, duo)) ?? null;
}

export function withSelected(s: MysterySession, duo: Duo): MysterySession {
  const card = offeredCard(s.offer, duo);
  if (!card) return s;
  return { ...s, selected: { characterId: card.characterId, pokemonId: card.pokemonId } };
}

export function withNickname(s: MysterySession, nickname: string): MysterySession {
  return { ...s, nickname };
}

/** The run ended: mark the session closed so a refresh starts a new session (and a new case). */
export function withClosed(s: MysterySession): MysterySession {
  return { ...s, closed: true };
}
