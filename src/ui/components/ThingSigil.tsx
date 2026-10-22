// ThingSigil (UX_MYSTERY §1): Thing's portrait, everywhere Thing appears (home emblem, duo cards, tutorial, HUD
// captions, results, dashboard advice). Renders the client-supplied photo (src/assets/thing/thing.png, picked up by
// thingArt.ts) inside a round lantern frame when present; falls back to the original line-art mark (stitched wrist,
// four fingers, thumb) otherwise. Sizes 24/32/64/96 px; `pose` is exposed as data-pose for CSS gestures (reduced
// motion: animation off, pose swaps only).
import { THING_ART } from '../mystery/thingArt.ts';

export type ThingPose = 'stand' | 'wave' | 'point' | 'shush' | 'count1' | 'count2' | 'count3' | 'thumbsUp' | 'tap' | 'fist';

interface ThingSigilProps {
  size?: 24 | 32 | 64 | 96;
  pose?: ThingPose;
  animated?: boolean;
  /** When given the sigil is announced as an image; otherwise decorative. */
  label?: string;
}

export function ThingSigil({ size = 32, pose = 'stand', animated = false, label }: ThingSigilProps) {
  if (THING_ART) {
    return (
      <span
        className={`thing-sigil thing-sigil--photo${animated ? ' thing-sigil--animated' : ''}`}
        style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}
        data-pose={pose}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        data-testid="thing-sigil"
      >
        <img src={THING_ART} alt="" className="thing-sigil__photo" draggable={false} />
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 96 96"
      className={`thing-sigil${animated ? ' thing-sigil--animated' : ''}`}
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}
      data-pose={pose}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-testid="thing-sigil"
    >
      <circle cx="48" cy="48" r="44" className="thing-sigil__ring" />
      <rect x="36" y="14" width="24" height="12" rx="4" />
      <path d="M40 14v12M46 14v12M52 14v12M58 14v12" className="thing-sigil__stitch" />
      <path d="M30 32a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v12a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10z" />
      <g className="thing-sigil__fingers">
        <path d="M35 52l-6 24" />
        <path d="M43 54l-2 26" />
        <path d="M53 54l2 26" />
        <path d="M61 52l6 24" />
      </g>
      <path d="M66 38l12 10" />
    </svg>
  );
}
