// LOCAL DEMO case assignment: a shuffled bag of the three case ids in localStorage['raven.mystery.caseBag'], drawn
// once per NEW session (never per refresh: the case is stored in the session). Each refill is a fresh crypto
// permutation that never starts with the case just dealt, so a kiosk deals every case once per three visitors.
// LIVE stations draw the same way server-side (mystery_create_session); this file is only the trusted-enough local
// stand-in. Independent of the duo offer: nothing here reads the seed.
import { isCaseId } from '../../mystery/data/cases.ts';
import { CASE_IDS, type CaseId } from '../../mystery/types.ts';

export const CASE_BAG_KEY = 'raven.mystery.caseBag';

export interface CaseBag { bag: CaseId[]; last: CaseId | null }

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;

/** Uniform index in [0, n) from crypto bytes (rejection sampling, no modulo bias). */
function uniformIndex(n: number, randomBytes: (n: number) => Uint8Array): number {
  const limit = 256 - (256 % n);
  for (;;) {
    const b = randomBytes(1)[0]!;
    if (b < limit) return b % n;
  }
}

/** A fresh permutation of the three ids (Fisher–Yates) that does not start with `last`. */
export function freshBag(last: CaseId | null, randomBytes: (n: number) => Uint8Array): CaseId[] {
  const bag = [...CASE_IDS];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = uniformIndex(i + 1, randomBytes);
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  if (last !== null && bag[0] === last) [bag[0], bag[1]] = [bag[1]!, bag[0]!];
  return bag;
}

export function readBag(storage: Store): CaseBag {
  try {
    const raw = storage?.getItem(CASE_BAG_KEY);
    if (!raw) return { bag: [], last: null };
    const v = JSON.parse(raw) as Partial<CaseBag>;
    const bag = Array.isArray(v.bag) ? v.bag.filter(isCaseId) : [];
    return { bag: [...new Set(bag)], last: isCaseId(v.last) ? v.last : null };
  } catch {
    return { bag: [], last: null };
  }
}

/** Deals the next case and persists the rest of the bag. */
export function drawCase(storage: Store, randomBytes: (n: number) => Uint8Array): CaseId {
  const state = readBag(storage);
  const bag = state.bag.length > 0 ? state.bag : freshBag(state.last, randomBytes);
  const [next, ...rest] = bag as [CaseId, ...CaseId[]];
  try {
    storage?.setItem(CASE_BAG_KEY, JSON.stringify({ bag: rest, last: next } satisfies CaseBag));
  } catch {
    // Storage disabled: the deal still works for this page view.
  }
  return next;
}
