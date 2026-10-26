// ThingCaption (UX_MYSTERY §3): bottom-centre, ≤ 2 lines, ThingSigil 32 + "THING" label + text + optional "Why:" line.
// Non-blocking, never focus-stealing; a polite live region so it never interrupts gameplay alerts.
import { ThingSigil, type ThingPose } from '../components/ThingSigil.tsx';

interface ThingCaptionProps {
  text: string;
  pose?: string;
  why?: string | null;
  headline?: boolean;
  /** Inline (results/footer) instead of absolutely positioned over the island. */
  inline?: boolean;
}

export function ThingNarrator({ text, pose = 'stand', why = null, headline = false, inline = false }: ThingCaptionProps) {
  return (
    <div
      className={`thing-caption${headline ? ' thing-caption--headline' : ''}${inline ? ' thing-caption--inline' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="thing-line"
      data-pose={pose}
    >
      <ThingSigil size={32} pose={pose as ThingPose} />
      <span className="thing-caption__who">Thing</span>
      <span className="thing-caption__text">{text}</span>
      {why && <span className="thing-caption__why">Why: {why}</span>}
    </div>
  );
}
