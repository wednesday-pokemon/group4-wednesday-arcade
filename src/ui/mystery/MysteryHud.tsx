// Mystery HUD (UX_OVERHAUL §1, 1366×768 boxes, rem-scaled): edges only, the centre 560×320 stays clear except the
// reticle. Red is reserved for the Hyde; lantern = objective / primary action; violet = clues; ivory = the egg; cyan =
// prediction. Every state is word + icon + border (greyscale-safe).
//   top-left   ObjectivePanel (16,16 · 288×84) + ClueCard (16,112 · 400×≤132)
//   top-centre Compass (451,12 · 464×36) + threats row (y56): HydeStatus pill 416×40 (+ Joseph Crackstone's squared
//              plaque 232×40 when the case has him; Hyde alone stays centred) + effect chips + ONE telegraph banner
//              (400×44, y124: curse > scan; toasts wait, the lock hint hides) + transient toast
//   top-right  Minimap (⌀224) + Odds (224×≤176) + KeyStrip (Tab · V · Esc)
//   centre     InteractPrompt / ExamineToast (y 512)      bottom-centre captions + ThingStack (x 403–963)
//   bottom-left Vitals (272×76)                            bottom-right Abilities Q / R (288×112)
import type { CSSProperties } from 'react';
import type { NavFeed } from '../../app/mystery/hud/navFeed.ts';
import { CLUE_ICON, THREAT, type AbilityHud, type Caption, type ExamineToastView, type MysteryHudModel, type ThreatEdgeView, type Toast } from '../../app/mystery/hudModel.ts';
import type { BannerView, CrackHudView } from '../../app/mystery/hud/crackstone.ts';
import { Icon } from '../Icon.tsx';
import { ClueCard } from './hud/ClueCard.tsx';
import { Compass } from './hud/Compass.tsx';
import { Minimap } from './hud/Minimap.tsx';
import { OddsPanel } from './hud/OddsPanel.tsx';
import { ThingStackView } from './hud/ThingStack.tsx';
import { abilityKey, KeyCap, KeyLegend } from './controls.tsx';
import '../styles/mhud.css';

interface MysteryHudProps {
  hud: MysteryHudModel;
  tutorial: boolean;
  pointerLocked: boolean;
  /** Settings "Show predictions": the Odds panel, the pill's risk segment and the map tints. */
  showPredictions: boolean;
  /** Compass + minimap feed (pulled ≤ 30 Hz by the canvases, outside React render). */
  nav: () => NavFeed | null;
  /** Onboarding step 2: lantern outline on the noise meter. */
  noiseFocus?: boolean;
}

const TIER_TEXT = { common: 'Common', rare: 'Rare', legendary: 'Legendary' } as const;
const NOISE_WORD = { silent: 'Silent', quiet: 'Quiet', audible: 'Audible', loud: 'LOUD' } as const;
const ARROW: Record<NonNullable<Caption['dir']>, string> = { ahead: '▴', behind: '▾', left: '◂', right: '▸' };

export function fmtClock(s: number): string {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

export function MysteryHud({ hud, tutorial, pointerLocked, showPredictions, nav, noiseFocus = false }: MysteryHudProps) {
  const playing = !tutorial && hud.status === 'playing';
  const hydeLive = playing && hud.hyde.emerged;
  const mode = hydeLive ? hud.hyde.mode : 'PATROL';
  const crack = playing ? hud.crack : null;
  // mist: the Hyde's red while it chases / searches; Crackstone's green while he hunts (R6: never both chasing)
  const crackMist = !!crack?.hunting && mode !== 'CHASE';
  const banner = playing ? hud.banner : null;
  const edge = playing ? hud.threatEdge : null;
  return (
    <div className={`mhud${hud.hidden ? ' is-hidden' : ''}${noiseFocus ? ' is-noise-focus' : ''}${tutorial ? ' is-tutorial' : ''}`} data-testid="mystery-hud">
      <div className="mhud-mist" data-mode={crackMist ? 'none' : hydeLive ? mode : 'none'} data-enemy={crackMist ? 'crackstone' : undefined} aria-hidden="true" />
      {hud.hidden && <div className="mhud-vignette" aria-hidden="true" />}
      {hud.catchFlashSeq > 0 && <div key={hud.catchFlashSeq} className="mhud-catch-flash" aria-hidden="true" />}
      {banner?.kind === 'curse_hit' && <div key={`curse${banner.id}`} className="mhud-curse-flash" aria-hidden="true" />}

      <ObjectivePanel hud={hud} tutorial={tutorial} />
      {hud.clueCard && <ClueCard c={hud.clueCard} />}

      <Compass feed={nav} />
      {playing && (
        <div className={`mhud-threats${crack ? ' has-crack' : ''}`}>
          <HydeStatus hud={hud} showRisk={showPredictions} />
          {crack && <CrackStatus c={crack} />}
        </div>
      )}
      {edge && <ThreatEdge e={edge} />}
      {banner && <TelegraphBanner b={banner} />}
      {!pointerLocked && !banner && <p className="mhud-lockhint" data-testid="hud-lockhint">Click to look around</p>}
      {hud.toast && !banner && <ToastView t={hud.toast} />}

      <div className="mhud-right">
        <Minimap feed={nav} />
        {showPredictions && !tutorial && <OddsPanel odds={hud.odds} />}
        {!tutorial && <KeyLegend variant="strip" hintCooldownS={hud.hintCooldownS} className="mhud-keystrip" data-testid="hud-keystrip" />}
      </div>

      {hud.examineToast ? <ExamineToast t={hud.examineToast} /> : hud.prompt && <InteractPrompt prompt={hud.prompt} />}
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
        {!tutorial && <ThingStackView log={hud.stack.log} card={hud.stack.card} />}
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
  const n = hud.clues.found.length;
  const objective = tutorial ? `Find ${hud.clues.total} clues. Save the egg.` : hud.objectiveText;
  return (
    <section className="mhud-panel mhud-objective" aria-label="Objective" data-testid="hud-objective-panel">
      <p className={`mhud-objective__text${objective.length > 20 ? ' is-long' : ''}`} data-testid="hud-objective" aria-live="polite">{objective}</p>
      <p className="mhud-objective__clues" data-testid="hud-clues" aria-label={`${n} of ${hud.clues.total} clues found`}>
        {hud.clues.order.map((id) => (
          <span key={id} className={`mhud-clue${hud.clues.found.includes(id) ? ' is-on' : ''}${hud.clueCard?.clueId === id && hud.clueCard.leaving ? ' is-new' : ''}`} aria-hidden="true">
            <Icon name={CLUE_ICON[id]} />
          </span>
        ))}
        <span className="num mhud-objective__count">{n}/{hud.clues.total}</span>
      </p>
      <div className={`mhud-egg mhud-egg--${egg.state}`} data-testid="hud-egg">
        <Icon name="egg" />
        {egg.state === 'resting' && <span>{egg.seenLabel ? <>Egg: seen · {egg.seenLabel}</> : 'Egg: not found'}</span>}
        {egg.state === 'carried' && egg.tier && (
          <>
            <span className={`tier-gem tier-gem--${egg.tier}`} aria-hidden="true" />
            <span><span className={`tier tier--${egg.tier}`}>{TIER_TEXT[egg.tier]}</span> · {egg.points} pts</span>
            <span className={`mhud-egg__sec${secLow ? ' is-low' : ''}`} role="meter" aria-label="Egg security" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(egg.security)}>
              <span style={{ width: `${Math.max(0, Math.min(100, egg.security))}%` }} />
            </span>
            <span className="mhud-egg__heavy">slower, louder</span>
          </>
        )}
        {egg.state === 'dropped' && <strong>Egg DROPPED — go back</strong>}
        {egg.state === 'delivered' && <span>Egg secured</span>}
      </div>
    </section>
  );
}

function HydeStatus({ hud, showRisk }: { hud: MysteryHudModel; showRisk: boolean }) {
  if (!hud.hyde.emerged) {
    return (
      <section className="mhud-pill" data-mode="DORMANT" aria-label="The Hyde" data-testid="hud-hyde">
        <p className="mhud-pill__state">
          <Icon name="hourglass" />
          <span className="mhud-pill__stack">
            {hud.crack && <span className="mhud-pill__kicker" aria-hidden="true">HYDE</span>}
            <span className="mhud-pill__word" data-testid="hud-hyde-dormant">{hud.hyde.emergesInS !== null ? `Hyde emerges in ${fmtClock(hud.hyde.emergesInS)}` : 'Hyde dormant'}</span>
          </span>
        </p>
      </section>
    );
  }
  const t = THREAT[hud.hyde.mode];
  const pct = Math.round(hud.hyde.suspicion * 100);
  const live = hud.hyde.mode === 'CHASE' ? 'assertive' : 'polite';
  const risk = showRisk ? hud.risk : null;
  const band = risk ? (risk.band === 'low' ? 'Low' : risk.band === 'medium' ? 'Medium' : 'High') : null;
  return (
    <section className="mhud-pill" data-mode={hud.hyde.mode} aria-label="The Hyde" data-testid="hud-hyde">
      <p className="mhud-pill__state" aria-live={live}>
        <Icon name={t.icon} />
        <span className="mhud-pill__stack">
          {hud.crack && <span className="mhud-pill__kicker" aria-hidden="true">HYDE</span>}
          <span className="mhud-pill__word">{t.word}</span>
        </span>
      </p>
      {risk && (
        <p className={`mhud-pill__risk risk-chip--${risk.source}`} data-testid="risk-chip" data-band={risk.band}>
          <Icon name="gauge" />
          <span className="mhud-pill__risk-text">{risk.detectedNow || hud.hyde.mode === 'CHASE' ? 'Risk: High · detected now' : `Risk: ${band} · next 15 s`}</span>
          <span className="mhud-pill__src" data-testid="risk-chip-label">{risk.label}</span>
        </p>
      )}
      <span className="mhud-pill__suspicion" role="meter" aria-label="Hyde suspicion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </span>
      {hud.hyde.effect && (
        <span className="mhud-pill__effect" data-testid="hud-effect">
          {hud.hyde.effect.word}{hud.hyde.effect.leftS !== null && <span className="num"> {hud.hyde.effect.leftS.toFixed(1)} s</span>}
        </span>
      )}
    </section>
  );
}

/**
 * Joseph Crackstone's status plaque (UX_ENEMIES §1): a SQUARED plaque (the Hyde is a round pill), caps kicker, hat /
 * eye / curse icons, a SEGMENTED suspicion underline, a DOUBLE border while he hunts. Word + icon + border carry every
 * state (greyscale-safe). Assertive only on CHASE / ATTACK.
 */
function CrackStatus({ c }: { c: CrackHudView }) {
  const pct = Math.round(c.meter * 100);
  return (
    <section className="mhud-pill mhud-crack" data-state={c.key} aria-label="Joseph Crackstone" data-testid="hud-crack">
      <p className="mhud-pill__state" aria-live={c.hunting ? 'assertive' : 'polite'}>
        <Icon name={c.icon} />
        <span className="mhud-pill__stack">
          <span className="mhud-pill__kicker" aria-hidden="true">CRACKSTONE</span>
          <span className="mhud-pill__word" data-testid="hud-crack-word">{c.word}</span>
        </span>
      </p>
      <span className="mhud-crack__meter" role="meter" aria-label="Crackstone suspicion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </span>
      {c.effect && (
        <span className="mhud-pill__effect mhud-crack__effect" data-testid="hud-crack-effect">
          {c.effect.word}{c.effect.leftS !== null && <span className="num"> {c.effect.leftS.toFixed(1)} s</span>}
        </span>
      )}
    </section>
  );
}

/**
 * ONE telegraph banner (400×44, y124): scan / curse countdown with exposure-aware copy (exposed: 3px double crack;
 * covered / clear: 1px dashed muted), a 4 px depleting bar (none with reduced motion — the number keeps counting), then
 * the 1–1.5 s result line. The assertive SR lines are spoken once by the loop (announce), so this is role="status".
 */
function TelegraphBanner({ b }: { b: BannerView }) {
  return (
    <div className={`mhud-banner is-${b.tone}`} data-kind={b.kind} data-exposure={b.exposure ?? undefined} role="status" data-testid="hud-banner">
      <Icon name={b.icon} />
      <p className="mhud-banner__text">
        <strong className="mhud-banner__head num" data-testid="hud-banner-head">{b.head}</strong>
        {b.text && <span className="mhud-banner__sub" data-testid="hud-banner-sub">{b.text}</span>}
      </p>
      {b.frac !== null && <span className="mhud-banner__bar" aria-hidden="true"><span style={{ width: `${Math.round(b.frac * 1000) / 10}%` }} /></span>}
    </div>
  );
}

/** The ONE chevron on the screen edge (§4 order); the Hyde's plain red / amber chevron, Crackstone's green + icon. */
function ThreatEdge({ e }: { e: ThreatEdgeView }) {
  const style: CSSProperties = { left: `${e.at.x * 100}%`, top: `${e.at.y * 100}%`, transform: `translate(-50%, -50%) rotate(${e.at.rot}rad)` };
  return (
    <span className={`mhud-edge${e.strong ? ' is-chase' : ''}${e.enemy === 'crack' ? ' is-crack' : ''}`} style={style} aria-hidden="true" data-testid="hud-threat-edge" data-enemy={e.enemy}>
      <Icon name="chevronUp" />
      {e.icon && <span className="mhud-edge__icon" style={{ transform: `rotate(${-e.at.rot}rad)` }}><Icon name={e.icon} /></span>}
    </span>
  );
}

function InteractPrompt({ prompt }: { prompt: NonNullable<MysteryHudModel['prompt']> }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className="mhud-prompt" data-testid="hud-prompt" data-kind={prompt.kind}>
      <p className="mhud-prompt__row">
        <span className="mhud-prompt__cap">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r={r} className="mhud-prompt__ring-bg" />
            {prompt.progress > 0 && <circle cx="20" cy="20" r={r} className="mhud-prompt__ring" strokeDasharray={`${c * prompt.progress} ${c}`} />}
          </svg>
          <KeyCap k="E" />
        </span>
        <span>{prompt.label.replace(/^Hold E: /, 'Hold: ')}</span>
      </p>
      {prompt.standStill && <p className="mhud-prompt__warn">Stand still to search</p>}
      {prompt.warning && <p className="mhud-prompt__warn" data-testid="hud-prompt-warning">{prompt.warning}</p>}
    </div>
  );
}

function ExamineToast({ t }: { t: ExamineToastView }) {
  return (
    <div className={`mhud-examine mhud-examine--${t.kind}`} data-testid="hud-examine-toast" role="status">
      <p className="mhud-examine__row">
        <Icon name={t.kind === 'passage' || t.kind === 'switch' ? 'key' : t.kind === 'empty' ? 'search' : 'eye'} />
        <span>
          {t.head && <strong className="mhud-examine__head">{t.head}</strong>}
          <span className="mhud-examine__text">{t.text}</span>
        </span>
      </p>
      {t.odds && (
        <p className="mhud-examine__odds" data-testid="hud-examine-odds"><Icon name="gauge" /> {t.odds}</p>
      )}
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
        <span className="mhud-caught" aria-label={`Caught ${hud.catches} of 2`} data-testid="hud-caught">
          Caught {[0, 1].map((i) => <span key={i} className={`pip-claw${i < hud.catches ? ' is-on' : ''}`} />)}
        </span>
      </div>
      <div className={`mhud-noise mhud-noise--${hud.noise.band}`} data-testid="hud-noise">
        <span className="caps">Noise</span>
        <span className="mhud-noise__segs" role="meter" aria-label="Your noise" aria-valuemin={0} aria-valuemax={10} aria-valuenow={seg}>
          {Array.from({ length: 10 }, (_, i) => <span key={i} className={i < seg ? (i >= 5 ? 'is-on is-hot' : 'is-on') : undefined} />)}
        </span>
        <span className="mhud-noise__word">
          {NOISE_WORD[hud.noise.band]}
          {hud.noise.radiusM > 0 && <span className="mhud-noise__radius num"> · {Math.round(hud.noise.radiusM)} m</span>}
        </span>
      </div>
      {hud.cursedLeftS !== null && (
        <p className="mhud-cursed" data-testid="hud-cursed">
          <Icon name="curse" />
          <span>CURSED · slowed <span className="num">{hud.cursedLeftS.toFixed(1)} s</span></span>
        </p>
      )}
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
        <img src={a.art} alt="" width={40} height={40} />
        <KeyCap k={abilityKey(a.key)} className="mhud-ability__key" />
      </span>
      <span className="mhud-ability__text">
        <span className="mhud-ability__name">{a.name}{a.loud && <span className="loud-tag">LOUD</span>}</span>
        <span className="mhud-ability__state num">{stateText}</span>
      </span>
    </div>
  );
}

function ToastView({ t }: { t: Toast }) {
  return (
    <p key={t.id} className={`mhud-toast mtoast mtoast--${t.tone}`} role="status" data-testid="hud-toast">
      <Icon name={t.icon} />
      <span>
        <strong>{t.headline}</strong>
        {t.sub && <span className="mtoast__sub">{t.sub}</span>}
      </span>
    </p>
  );
}
