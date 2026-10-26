// Thing's prologue (story script v3.2): six ~5 s cinematic panels between the duo cards and the tutorial, then the
// mission card. Pure data + timeline helpers; the screen is src/ui/mystery/ThingPrologue.tsx.
// Rules: Thing is nonverbal — every line is labelled as a translation of his gestures; the prologue never singles out
// a suspect (the culprit is only revealed by the player's accusation). Panels 2–3 tell the ASSIGNED case's story
// (CaseDef.prologue); the others are shared by all three cases.
import { STAY_SILENT_LINE } from './thingLines.ts';
import type { CaseDef } from '../../mystery/types.ts';
import type { ThingPose } from '../../mystery/data/thing.ts';
import type { Sfx } from '../audio.ts';

export type PrologueSceneId = 'island' | 'death' | 'egg' | 'suspects' | 'hyde' | 'assignment';

export interface ProloguePanel {
  id: PrologueSceneId;
  title: string;
  /** Thing's message (translated). */
  narration: string;
  /** Thing's gesture while the panel plays. */
  pose: ThingPose;
  /** Panel audio cue; 'heartbeat' repeats while the panel is on screen. */
  cue: Sfx | null;
  durationS: number;
  /** Extra on-screen caption (panel 5's exact Stay Silent warning). */
  warning?: string;
  /**
   * Optional translation voiceover: a URL under public/ (e.g. `audio/prologue/panel-1.mp3`). When set, the panel
   * waits for the clip to finish before auto-advancing. None are shipped yet.
   */
  voice?: string;
}

/** The shared panels with Case 01's story in panels 2–3 (use prologuePanels(caseDef) for the session's case). */
export const PROLOGUE_PANELS: readonly ProloguePanel[] = [
  {
    id: 'island', title: 'The Island, After Dark', pose: 'point', cue: 'whoosh', durationS: 5,
    narration: 'Nobody visits Raven Island after sunset. Not if they intend to return.',
  },
  {
    id: 'death', title: 'A Death at Nevermore', pose: 'stand', cue: 'toll', durationS: 5,
    narration: 'Professor Orloff was found dead near the restricted research chamber. The truth was buried with the evidence.',
  },
  {
    id: 'egg', title: 'The Vanished Egg', pose: 'tap', cue: 'chime', durationS: 5,
    narration: 'A rare Pokémon egg has disappeared. It may be the key to understanding what happened.',
  },
  {
    id: 'suspects', title: 'Three Suspects', pose: 'count3', cue: null, durationS: 5,
    narration: 'Marilyn Thornhill. Françoise Galpin. Barry Dort. Their stories cannot all be true.',
  },
  {
    id: 'hyde', title: 'Something Listens', pose: 'shush', cue: 'heartbeat', durationS: 5, warning: STAY_SILENT_LINE,
    narration: 'The Hyde is hunting. It hears careless footsteps, dropped objects… even panic.',
  },
  {
    id: 'assignment', title: 'Your Assignment', pose: 'point', cue: 'ready', durationS: 5,
    narration: 'Follow the clues. Protect the egg. Reach Iago Tower. Decide who is responsible — but don’t accuse without proof.',
  },
];

/** The six panels for one case: its own death + egg story, the shared island / suspects / Hyde / assignment. */
export function prologuePanels(caseDef: CaseDef): ProloguePanel[] {
  return PROLOGUE_PANELS.map((p) => {
    if (p.id === 'death') return { ...p, title: caseDef.prologue.death.title, narration: caseDef.prologue.death.narration };
    if (p.id === 'egg') return { ...p, title: caseDef.prologue.egg.title, narration: caseDef.prologue.egg.narration };
    // the case's own suspects (final: Thornhill, Galpin, Barry — Isaac Night is the Slurp monster, not a suspect)
    if (p.id === 'suspects' && caseDef.suspects.length) return { ...p, narration: `${caseDef.suspects.map((x) => `${x.name}.`).join(' ')} Their stories cannot all be true.` };
    return p;
  });
}

export const PROLOGUE_MISSION = ['Investigate the Murder.', 'Secure the Egg.', 'Escape Alive.'] as const;
export const PROLOGUE_TOTAL_S = PROLOGUE_PANELS.reduce((t, p) => t + p.durationS, 0);
export const HEARTBEAT_EVERY_S = 0.9;

/** Index of the mission card (one past the last panel). */
export const MISSION_INDEX = PROLOGUE_PANELS.length;

export interface PrologueState {
  /** 0…5 = panel, MISSION_INDEX = mission card. */
  index: number;
  /** Seconds into the current panel. */
  elapsedS: number;
  /** Auto-advance on; any manual navigation turns it off (script v3.2 production note). */
  autoplay: boolean;
  /** Waiting for this panel's voice clip to finish before auto-advancing. */
  voicePending: boolean;
}

export type PrologueAction =
  | { type: 'tick'; dt: number }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'toggleAutoplay' }
  | { type: 'replay' }
  | { type: 'voice'; pending: boolean };

export const initialPrologue = (): PrologueState => ({ index: 0, elapsedS: 0, autoplay: true, voicePending: false });

const go = (index: number, autoplay: boolean): PrologueState => ({
  index: Math.max(0, Math.min(MISSION_INDEX, index)), elapsedS: 0, autoplay, voicePending: false,
});

export function prologueReducer(s: PrologueState, a: PrologueAction): PrologueState {
  switch (a.type) {
    case 'tick': {
      if (!s.autoplay || s.index >= MISSION_INDEX) return s;
      const elapsedS = s.elapsedS + a.dt;
      // The mission card waits for "Enter Raven Island" (the 30 s is a target, not a forced watch).
      if (elapsedS >= PROLOGUE_PANELS[s.index]!.durationS && !s.voicePending) return go(s.index + 1, true);
      return { ...s, elapsedS };
    }
    case 'next':
      return go(s.index + 1, false);
    case 'back':
      return s.index === 0 ? { ...s, autoplay: false } : go(s.index - 1, false);
    case 'toggleAutoplay':
      return s.index >= MISSION_INDEX ? s : { ...s, autoplay: !s.autoplay };
    case 'replay':
      return initialPrologue();
    case 'voice':
      return { ...s, voicePending: a.pending };
    default:
      return s;
  }
}

/** 0…1 progress of a panel segment in the top progress bar. */
export function segmentFill(s: PrologueState, i: number): number {
  if (i < s.index) return 1;
  if (i > s.index) return 0;
  return Math.min(1, s.elapsedS / PROLOGUE_PANELS[i]!.durationS);
}
