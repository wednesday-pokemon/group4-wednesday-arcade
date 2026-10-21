// Cinematic captions (max 4 words) and screen-reader alerts derived from a backend LegResolution.
import type { LegResolution } from '../../game/index.ts';
import type { RaceBeat } from '../../app/sceneHost.ts';
import { MINUS, fmtDS } from '../format.ts';

export function captionFor(beat: RaceBeat, r: LegResolution): string | null {
  switch (beat) {
    case 'route':
      if (r.time.weatherDelayCs <= 0) return null;
      return `${r.weather === 'heavy_fog' ? 'FOG' : 'CURRENTS'}: ${fmtDS(r.time.weatherDelayCs)}`;
    case 'egg': return r.eggAttempted ? 'EGG ABOARD' : null;
    case 'crash':
      if (!r.crashOccurred) return null;
      return r.crashNegatedBy ? 'CRASH SHRUGGED OFF' : `CRASH: ${MINUS}${r.crashHpLoss} HP`;
    case 'hyde': return 'HYDE CLOSES IN';
    case 'catch': return r.hydeCatch ? `CAUGHT: ${r.catchNumber} of 2` : null;
    case 'escape': return r.hydeCatch ? null : 'ESCAPED';
    case 'dnf': return 'OUT OF THE RACE';
    case 'finish': return r.outcome === 'finished' ? 'DOCKED' : null;
    default: return null;
  }
}

export function alertFor(beat: RaceBeat, r: LegResolution): string | null {
  if (beat === 'crash' && r.crashOccurred) return r.crashNegatedBy ? 'Crash, but no damage.' : `Crash. Minus ${r.crashHpLoss} HP.`;
  if (beat === 'catch' && r.hydeCatch) return `Hyde caught you. Catch ${r.catchNumber} of 2.`;
  if (beat === 'dnf') return r.dnfReason === 'second_catch' ? 'Race over: second Hyde catch.' : 'Race over: your boat ran out of HP.';
  return null;
}
