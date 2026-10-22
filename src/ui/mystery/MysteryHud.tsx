// Mystery HUD (UX_MYSTERY §4): edges only; centre 560×320 stays clear. Red is reserved for the Hyde; every threat state
// changes word + icon + border style (greyscale-safe).
//   top-left ObjectivePanel (+ EvidenceToast)   top-centre ThreatMeter (word, suspicion, Caught ○○)   top-right key chips + RiskChip slot
//   centre (y 32rem) InteractPrompt + ring       bottom-centre CaptionStack above the ThingCaption
//   bottom-left VitalsPanel (HP, noise + radius, hidden)              bottom-right AbilitySlots F / Q
import type { CSSProperties } from 'react';
import { CLUE_ICON, THREAT, type AbilityHud, type Caption, type MysteryHudModel, type Toast } from '../../app/mystery/hudModel.ts';
import { Icon } from '../Icon.tsx';
import { ThingNarrator } from './ThingNarrator.tsx';

interface MysteryHudProps {
  hud: MysteryHudModel;
  tutorial: boolean;
  pointerLocked: boolean;
  showRisk: boolean;
}

const TIER_TEXT = { common: 'Common', rare: 'Rare', legendary: 'Legendary' } as const;
const NOISE_WORD = { silent: 'Silent', quiet: 'Quiet', audible: 'Audible', loud: 'LOUD' } as const;
const ARROW: Record<NonNullable<Caption['dir']>, string> = { ahead: '▴', behind: '▾', left: '◂', right: '▸' };

export function MysteryHud({ hud, tutorial, pointerLocked, showRisk }: MysteryHudProps) {
  const hydeLive = !tutorial && hud.status === 'playing';
  const mode = hydeLive ? hud.hyde.mode : 'PATROL';
  return (
    <div className={`mhud${hud.hidden ? ' is-hidden' : ''}`} data-testid="mystery-hud">
      <div className="mhud-mist" data-mode={hydeLive ? mode : 'none'} aria-hidden="true" />
      {hud.hidden && <div className="mhud-vignette" aria-hidden="true" />}
      {hud.catchFlashSeq > 0 && <div key={hud.catchFlashSeq} className="mhud-catch-flash" aria-hidden="true" />}

      <ObjectivePanel hud={hud} tutorial={tutorial} />
      {hud.evidenceToast && <ToastView t={hud.evidenceToast} className="mhud-evidence-toast" />}

      {hydeLive && <ThreatMeter hud={hud} />}
      {hydeLive && hud.hyde.edgeAt && <ThreatEdge at={hud.hyde.edgeAt} chase={mode === 'CHASE'} />}

      <div className="mhud-topright">
        <p className="mhud-chips">
          <span><kbd>Esc</kbd> Pause</span>
          <span><kbd>Tab</kbd> Board</span>
          <span className={hud.hintCooldownS > 0 ? 'is-cooling' : undefined}>
            <kbd>V</kbd> Hint{hud.hintCooldownS > 0 && <span className="num"> {hud.hintCooldownS} s</span>}
          </span>
          <span><kbd>M</kbd></span>
        </p>
        {!pointerLocked && <p className="mhud-lockhint">Click the island to look with the mouse</p>}
        {showRisk && hud.risk && (
          <p className={`risk-chip risk-chip--${hud.risk.source}`} data-testid="risk-chip" data-band={hud.risk.band}>
            <Icon name="gauge" />
            <span>
              {hud.risk.detectedNow ? 'Risk: High · detected now' : `Risk: ${hud.risk.band === 'low' ? 'Low' : hud.risk.band === 'medium' ? 'Medium' : 'High'} · next 15 s`}
            </span>
            <span className="risk-chip__src" data-testid="risk-chip-label">{hud.risk.label}</span>
          </p>
        )}
      </div>

      {hud.toast && <ToastView t={hud.toast} className="mhud-toast" />}

      {hud.prompt && <InteractPrompt prompt={hud.prompt} />}
      {(hud.power.aimed && hud.power.ready) || (hud.move.aimed && hud.move.ready) ? <span className="mhud-reticle" aria-hidden="true" /> : null}

      <div className="mhud-bottom">
        {hud.captions.length > 0 && (
          <ul className="mhud-captions" data-testid="hud-captions">
            {hud.captions.map((c) => (
              <li key={c.id} className={`mhud-caption mhud-caption--${c.tone}`}>
                {c.text}{c.dir && <span className="mhud-caption__dir" aria-label={c.dir}> {ARROW[c.dir]}</span>}
              </li>
            ))}
          </ul>
        )}
        {hud.thing && <ThingNarrator key={hud.thing.key + hud.thing.text} text={hud.thing.text} pose={hud.thing.pose} why={hud.thing.why} />}
      </div>

      <VitalsPanel hud={hud} />

      <section className="mhud-abilities" aria-label="Abilities">
        <AbilitySlot a={hud.power} />
        <AbilitySlot a={hud.move} />
      </section>
    </div>
  );
}

function ObjectivePanel({ hud, tutorial }: { hud: MysteryHudModel; tutorial: boolean }) {
  const egg = hud.egg;
  const secLow = egg.security < 40;
  return (
    <section className="mhud-panel mhud-objective" aria-label="Objective">
      <p className="mhud-objective__text" data-testid="hud-objective" aria-live="polite">{tutorial ? 'Practise at the pier' : hud.objectiveText}</p>
      <p className="mhud-row">
        <span className="caps">Clues</span>
        <span className="mhud-clues" aria-label={`${hud.clues.found.length} of ${hud.clues.total} clues found`} data-testid="hud-clues">
          {hud.clues.order.map((id) => (
            <span key={id} className={`mhud-clue${hud.clues.found.includes(id) ? ' is-on' : ''}`} aria-hidden="true">
              <Icon name={CLUE_ICON[id]} />
            </span>
          ))}
          <span className="num">{hud.clues.found.length}/{hud.clues.total}</span>
        </span>
      </p>
      <div className={`mhud-egg mhud-egg--${egg.state}`} data-testid="hud-egg">
        <Icon name="egg" />
        {egg.state === 'resting' && <span>Egg · not found</span>}
        {egg.state === 'carried' && egg.tier && (
          <>
            <span><span className={`tier tier--${egg.tier}`}>{TIER_TEXT[egg.tier]}</span> · {egg.points} pts</span>
            <span className={`mhud-egg__sec${secLow ? ' is-low' : ''}`} role="meter" aria-label="Egg security" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(egg.security)}>
              <span style={{ width: `${Math.max(0, Math.min(100, egg.security))}%` }} />
            </span>
            <span className="mhud-egg__heavy">Heavy: slower, louder</span>
          </>
        )}
        {egg.state === 'dropped' && <strong>Egg DROPPED — go back for it</strong>}
        {egg.state === 'delivered' && <span>Egg secured</span>}
      </div>
    </section>
  );
}

function ThreatMeter({ hud }: { hud: MysteryHudModel }) {
  const t = THREAT[hud.hyde.mode];
  const pct = Math.round(hud.hyde.suspicion * 100);
  const live = hud.hyde.mode === 'CHASE' ? 'assertive' : 'polite';
  return (
    <section className="threat" data-mode={hud.hyde.mode} aria-label="The Hyde" data-testid="hud-hyde">
      <p className="threat__state" aria-live={live}>
        <Icon name={t.icon} />
        <span className="threat__word">{t.word}</span>
        {hud.hyde.effect && (
          <span className="threat__effect">· {hud.hyde.effect.word}{hud.hyde.effect.leftS !== null && <span className="num"> {hud.hyde.effect.leftS.toFixed(1)} s</span>}</span>
        )}
      </p>
      <span className="threat__track" role="meter" aria-label="Hyde suspicion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className="threat__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="threat__caught" aria-label={`Caught ${hud.catches} of 2`}>
        Caught {[0, 1].map((i) => <span key={i} className={`pip-claw${i < hud.catches ? ' is-on' : ''}`} />)}
        <span className="num"> {hud.catches}/2</span>
      </span>
    </section>
  );
}

/** Chevron on the screen edge pointing toward the Hyde while it searches/chases off-screen (UX §4 ThreatEdge). */
function ThreatEdge({ at, chase }: { at: { x: number; y: number; rot: number }; chase: boolean }) {
  const style: CSSProperties = { left: `${at.x * 100}%`, top: `${at.y * 100}%`, transform: `translate(-50%, -50%) rotate(${at.rot}rad)` };
  return (
    <span className={`mhud-edge${chase ? ' is-chase' : ''}`} style={style} aria-hidden="true" data-testid="hud-threat-edge">
      <Icon name="chevronUp" />
    </span>
  );
}

function InteractPrompt({ prompt }: { prompt: NonNullable<MysteryHudModel['prompt']> }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className="mhud-prompt" data-testid="hud-prompt">
      <p className="mhud-prompt__row">
        <span className="mhud-prompt__cap">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r={r} className="mhud-prompt__ring-bg" />
            {prompt.progress > 0 && <circle cx="20" cy="20" r={r} className="mhud-prompt__ring" strokeDasharray={`${c * prompt.progress} ${c}`} />}
          </svg>
          <kbd>E</kbd>
        </span>
        <span>{prompt.label}</span>
      </p>
      {prompt.warning && <p className="mhud-prompt__warn">{prompt.warning}</p>}
    </div>
  );
}

function VitalsPanel({ hud }: { hud: MysteryHudModel }) {
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const low = hud.hp <= 35;
  const seg = Math.round(hud.noise.level * 10);
  return (
    <section className="mhud-panel mhud-vitals" aria-label="Your condition">
      <div className={`mhud-bar mhud-bar--hp${low ? ' is-low' : ''}`}>
        <span className="caps">HP</span>
        <span className="mhud-bar__track"><span className="mhud-bar__fill" style={{ width: `${hpPct}%` }} /></span>
        <span className="mhud-bar__value num" data-testid="hud-hp">{Math.round(hud.hp)}</span>
        {low && <span className="mhud-bar__low">Low</span>}
      </div>
      <div className={`mhud-noise mhud-noise--${hud.noise.band}`} data-testid="hud-noise">
        <span className="caps">Noise</span>
        <span className="mhud-noise__segs" role="meter" aria-label="Your noise" aria-valuemin={0} aria-valuemax={10} aria-valuenow={seg}>
          {Array.from({ length: 10 }, (_, i) => <span key={i} className={i < seg ? (i >= 5 ? 'is-on is-hot' : 'is-on') : undefined} />)}
        </span>
        <span className="mhud-noise__word">
          {NOISE_WORD[hud.noise.band]}
          {hud.noise.radiusM > 0 && <span className="mhud-noise__radius num"> · heard within {Math.round(hud.noise.radiusM)} m</span>}
        </span>
      </div>
      {hud.hidden && (
        <p className={`mhud-hidden${hud.tooClose ? ' is-close' : ''}`} data-testid="hud-hidden">
          <Icon name="eyeClosed" />
          {hud.tooClose ? 'Too close — it may spot you' : 'HIDDEN · it can still hear you'}
        </p>
      )}
    </section>
  );
}

function AbilitySlot({ a }: { a: AbilityHud }) {
  const pct = a.ready || a.cooldownS <= 0 ? 100 : Math.max(0, Math.min(100, 100 - (a.cooldownLeftS / a.cooldownS) * 100));
  const state = a.activeLeftS > 0 ? 'active' : a.ready ? 'ready' : 'cooling';
  const stateText = a.denied?.text ?? (state === 'active' ? `ACTIVE ${a.activeLeftS.toFixed(1)} s` : state === 'ready' ? 'READY' : `${Math.ceil(a.cooldownLeftS)} s`);
  return (
    <div className={`mhud-ability is-${state}`} data-testid={`hud-ability-${a.key}`} key={a.denied ? `d${a.denied.seq}` : 'ok'} data-denied={a.denied ? true : undefined}>
      <span className="mhud-ability__ring" style={{ ['--cd' as string]: `${pct}%` }}>
        <img src={a.art} alt="" width={48} height={48} />
        <kbd className="mhud-ability__key">{a.key}</kbd>
      </span>
      <span className="mhud-ability__text">
        <span className="mhud-ability__name">{a.name}{a.loud && <span className="loud-tag">LOUD</span>}</span>
        <span className="mhud-ability__state num">{stateText}</span>
      </span>
    </div>
  );
}

function ToastView({ t, className }: { t: Toast; className: string }) {
  return (
    <p key={t.id} className={`${className} mtoast mtoast--${t.tone}`} role="status" data-testid={className}>
      <Icon name={t.icon} />
      <span>
        <strong>{t.headline}</strong>
        {t.sub && <span className="mtoast__sub">{t.sub}</span>}
      </span>
    </p>
  );
}
