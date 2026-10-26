// Stage 1 real-time HUD (UX_V3_ACTION §1). Edges only: objective top-left, Hyde meter top-centre (with catch pips),
// key chips top-right, one message slot under the meter, vitals bottom-left (HP, stamina, speed/cadence), Q ability
// bottom-right. Centre and bottom-centre stay clear for the boat and the Hyde behind it.
// Red is reserved for the Hyde: collisions get a short parchment edge flash.
import type { HudV3, StaminaTrend } from '../../app/v3/useStageLoop.ts';
import type { PokemonId } from '../../game/index.ts';
import { Icon } from '../Icon.tsx';
import { characterPortrait } from '../v3/crewData.ts';
import { AbilityPanel } from './AbilityPanel.tsx';
import { HydeMeter } from './HydeMeter.tsx';
import { RescuePrompt, RescueToast } from './RescuePrompt.tsx';

const TREND: Record<StaminaTrend, { glyph: string; label: string }> = {
  recovering: { glyph: '▲', label: 'recovering' },
  steady: { glyph: '', label: '' },
  draining: { glyph: '▼', label: 'draining' },
  draining_fast: { glyph: '▼▼', label: 'draining fast' },
};

interface BarProps { label: string; value: number; max: number; tone: 'hp' | 'stamina'; testId: string; word?: string | null; trend?: StaminaTrend }

function Bar({ label, value, max, tone, testId, word, trend }: BarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tr = trend ? TREND[trend] : null;
  return (
    <div className={`ahud-bar ahud-bar--${tone}${pct < 25 ? ' is-low' : ''}${trend ? ` is-${trend}` : ''}`} data-testid={testId} data-trend={trend}>
      <span className="ahud-bar__label">{label}</span>
      <span className="ahud-bar__track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(value)}>
        <span className="ahud-bar__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="ahud-num ahud-bar__value">{Math.round(value)}</span>
      <span className="ahud-bar__trend" aria-label={tr?.label || undefined}>{tr?.glyph}</span>
      {word && <span className="ahud-bar__word" data-testid={`${testId}-word`}>{word}</span>}
    </div>
  );
}

interface ActionHudProps {
  hud: HudV3;
  pokemonId: PokemonId;
  pokemonName: string;
  abilityName: string;
  /** Tutorial shows its own panel in the message slot and the key strip; no objective/Hyde yet. */
  tutorial?: boolean;
  pauseDenied?: boolean;
}

export function ActionHud({ hud, pokemonId, pokemonName, abilityName, tutorial, pauseDenied }: ActionHudProps) {
  const cinematic = hud.cinematic !== null;
  const rescue = hud.rescue;
  const dimOthers = rescue !== null;
  const level = hud.hyde.active ? hud.hyde.level : 0;
  const staminaLow = hud.stamina / hud.maxStamina < 0.25;
  const overpacing = hud.staminaTrend === 'draining_fast';
  const staminaWord = staminaLow ? (overpacing ? 'Low — slow your strokes' : 'Low — glide with W') : overpacing ? 'Draining fast — steady strokes' : null;
  return (
    <div className={`ahud${cinematic ? ' is-cinematic' : ''}${dimOthers ? ' is-rescue' : ''}`} data-testid="action-hud">
      <div className="ahud-danger" data-level={tutorial ? 0 : level} aria-hidden="true" />
      {hud.bumpSeq > 0 && <div key={hud.bumpSeq} className="ahud-bump" aria-hidden="true" />}

      {!tutorial && (
        <section className="ahud-objective ahud-panel" aria-label="Objective">
          <p className="ahud-stage">Stage 1 · The Crossing</p>
          <div className="ahud-progress" aria-hidden="true"><span className="ahud-progress__fill" style={{ width: `${hud.progress * 100}%` }} /></div>
          <p className="ahud-dist">
            <span className="ahud-num" data-testid="hud-distance">{Math.round(hud.distanceLeft)} m</span> to Raven Island ·{' '}
            <span className="ahud-num">{hud.t.toFixed(1)} s</span>
          </p>
        </section>
      )}

      {!tutorial && <HydeMeter active={hud.hyde.active} gap={hud.hyde.gap} level={level} surge={hud.hyde.surge} catches={hud.catches} />}

      <p className="ahud-chips" aria-label="Keys">
        <span><kbd>Esc</kbd> pause</span>
        <span className={hud.holdToRow ? 'is-on' : ''}><kbd>H</kbd> {hud.holdToRow ? 'hold-to-row on' : 'hold-to-row'}</span>
      </p>

      {!rescue && hud.message && (
        <p key={hud.message.key} className={`ahud-message ahud-message--${hud.message.kind}`} role="status" data-testid="hud-message">
          {hud.message.kind === 'wednesday' && <img className="ahud-message__face" src={characterPortrait('wednesday')} alt="Wednesday" width={32} height={32} />}
          <span>{hud.message.text}</span>
        </p>
      )}
      {pauseDenied && <p className="ahud-chip-note" role="status">Pause after the rescue</p>}

      <section className="ahud-vitals ahud-panel" aria-label="Boat status">
        <Bar label="HP" value={hud.hp} max={hud.maxHp} tone="hp" testId="hud-hp" />
        <Bar label="Stamina" value={hud.stamina} max={hud.maxStamina} tone="stamina" testId="hud-stamina" word={staminaWord} trend={hud.staminaTrend} />
        <p className="ahud-speed" data-testid="hud-speed">
          <span className="ahud-num ahud-speed__value">{hud.speed.toFixed(1)}</span> m/s
          <span className="ahud-speed__track" aria-hidden="true"><span style={{ width: `${Math.min(100, (hud.speed / hud.maxSpeed) * 100)}%` }} /></span>
          <span className="ahud-num">{hud.cadence.toFixed(1)}</span> taps/s
        </p>
      </section>

      <AbilityPanel
        pokemonId={pokemonId}
        pokemonName={pokemonName}
        abilityName={abilityName}
        a={hud.ability}
        hydeNear={hud.hyde.active && hud.hyde.gap < 30}
      />

      {rescue && (
        <RescuePrompt
          rescue={rescue}
          pokemonName={pokemonName}
          abilityName={abilityName}
          cooldownLeftS={hud.ability.cooldownLeftS}
          noCharges={hud.ability.chargesLeft === 0}
        />
      )}
      {!rescue && hud.toast && <RescueToast toast={hud.toast} />}

      {cinematic && (
        <p className="ahud-skip" data-testid="hud-cinematic-skip">
          <kbd>Space</kbd> Skip
        </p>
      )}

      {hud.ending === 'finished' && (
        <p className="ahud-banner ahud-banner--finish" role="status"><Icon name="flag" /> Raven Island!</p>
      )}
    </div>
  );
}
