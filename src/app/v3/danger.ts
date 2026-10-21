// Hyde danger level with hysteresis (UX_V3_ACTION §2): 0 calm (gap ≥ 25), 1 gaining (15–25 or surge telegraph),
// 2 close (< 15). A level is exited only 3 m past its entry threshold, and every level lasts at least 0.5 s.
export type DangerLevel = 0 | 1 | 2;

export const DANGER = { gainingBelow: 25, closeBelow: 15, hysteresis: 3, minHoldS: 0.5 } as const;

export class DangerTracker {
  level: DangerLevel = 0;
  private since = -Infinity;

  reset(): void {
    this.level = 0;
    this.since = -Infinity;
  }

  /** `now` in seconds (any monotonic clock). `active` = the Hyde is out of the water and hunting. */
  update(gap: number, surge: boolean, active: boolean, now: number): DangerLevel {
    let target: DangerLevel;
    if (!active) target = 0;
    else {
      const raw: DangerLevel = gap < DANGER.closeBelow ? 2 : gap < DANGER.gainingBelow || surge ? 1 : 0;
      target = raw;
      if (raw < this.level) {
        // Hysteresis: only step down once the gap is 3 m past the threshold we entered on.
        if (this.level === 2 && gap < DANGER.closeBelow + DANGER.hysteresis) target = 2;
        else if (this.level >= 1 && raw === 0 && gap < DANGER.gainingBelow + DANGER.hysteresis && !surge) target = 1;
      }
    }
    if (target !== this.level && now - this.since >= DANGER.minHoldS) {
      this.level = target;
      this.since = now;
    }
    return this.level;
  }
}

export const DANGER_COPY: Record<DangerLevel, { word: string; icon: 'eyeClosed' | 'eye' | 'claw' }> = {
  0: { word: 'Distant', icon: 'eyeClosed' },
  1: { word: 'Gaining', icon: 'eye' },
  2: { word: 'Right behind you', icon: 'claw' },
};
