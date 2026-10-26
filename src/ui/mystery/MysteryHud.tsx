// Mystery HUD v3 (docs/final/UX_FINAL.md §1, 1366×768 boxes, rem-scaled): edges only, the centre 560×320 stays clear.
// Zoning by purpose: left = investigation (Objective, Ask Weems, ClueCard / WeemsCard slot); top centre = threats
// (Compass + the Threats strip of three 200 px chips + effect chips + ONE telegraph banner); right = map + odds (minimap,
// lens bar, Odds v3, KeyStrip); bottom centre = Why + Thing (captions + ThingStack); bottom corners = you (Vitals with the
// Tally row, abilities Q / R). Weems and Thing never share a slot, a colour or a typeface. Every state is word + icon +
// border (greyscale-safe). The cabinet hiding view is the first child, under the panels.
import type { CSSProperties } from 'react';
import type { NavFeed } from '../../app/mystery/hud/navFeed.ts';
import { CLUE_ICON, type AbilityHud, type Caption, type ExamineToastView, type MysteryHudModel, type ThreatEdgeView, type Toast } from '../../app/mystery/hudModel.ts';
import type { BannerView } from '../../app/mystery/hud/crackstone.ts';
import { crackChip, directorChip, hydeChip, type ThreatChipView } from '../../app/mystery/hud/enemies.ts';
import { TALLY_COPY } from '../../app/mystery/hud/tally.ts';
import { Icon } from '../Icon.tsx';
import { ClueCard } from './hud/ClueCard.tsx';
import { Compass } from './hud/Compass.tsx';
import { Minimap } from './hud/Minimap.tsx';
import { OddsPanel } from './hud/OddsPanel.tsx';
import { ThingStackView } from './hud/ThingStack.tsx';
import { ThreatsStrip } from './hud/ThreatsStrip.tsx';
import { LensBar } from './hud/LensBar.tsx';
import { CabinetBlock, CabinetOverlay } from './hud/CabinetHud.tsx';
import { AskWeemsButton, WeemsCard } from './hud/Weems.tsx';
import { HudIcon } from './hud/HudIcon.tsx';
import { abilityKey, KeyCap, KeyLegend } from './controls.tsx';
import '../styles/mhud.css';
import '../styles/mhudFinal.css';

interface MysteryHudProps {
  hud: MysteryHudModel;
  tutorial: boolean;
  pointerLocked: boolean;
  /** Settings "Show predictions": the Odds panel, the lens bar and the map tints. */
  showPredictions: boolean;
  /** Compass + minimap feed (pulled ≤ 30 Hz by the canvases, outside React render). */
  nav: () => NavFeed | null;
  /** Onboarding step 2: lantern outline on the noise meter. */
  noiseFocus?: boolean;
  /** Ask Weems button click (same flow as V). */
  onAskWeems?: () => void;
}

const TIER_TEXT = { common: 'Common', rare: 'Rare', legendary: 'Legendary' } as const;
const NOISE_WORD = { silent: 'Silent', quiet: 'Quiet', audible: 'Audible', loud: 'LOUD' } as const;
const ARROW: Record<NonNullable<Caption['dir']>, string> = { ahead: '▴', behind: '▾', left: '◂', right: '▸' };

export { fmtClock } from '../../app/mystery/hud/enemies.ts';

/** Older models (no `threats`): the strip is derived from the Hyde + Crackstone fields. */
export function legacyChips(hud: MysteryHudModel): ThreatChipView[] {
  const out: ThreatChipView[] = [];
  const hyde = hud.hyde.emerged
    ? hydeChip(hud.hyde.mode, hud.hyde.suspicion, hud.hyde.effect)
    : directorChip({ enemy: 'hyde', present: true, active: false, phase: 'inactive', arrivesInS: hud.hyde.emergesInS, everActive: false });
  if (hyde) out.push(hyde);
  if (hud.crack) out.push(crackChip(hud.crack.key, hud.crack.meter, hud.crack.effect));
  return out;
}

export function MysteryHud({ hud, tutorial, pointerLocked, showPredictions, nav, noiseFocus = false, onAskWeems }: MysteryHudProps) {
  const playing = !tutorial && hud.status === 'playing';
  const hydeLive = playing && hud.hyde.emerged;
  const mode = hydeLive ? hud.hyde.mode : 'PATROL';
  const crack = playing ? hud.crack : null;
  const chips = playing ? hud.threats ?? legacyChips(hud) : [];
  // mist: the Hyde's red while it chases / searches; Crackstone's green / Slurp's orchid while they hunt (≤ 1 engaged)
  const crackMist = !!crack?.hunting && mode !== 'CHASE';
  const slurpMist = playing && !!hud.slurpHunting && mode !== 'CHASE' && !crackMist;
  const banner = playing ? hud.banner : null;
  const edge = playing ? hud.threatEdge : null;
  const cab = hud.cabinet ?? null;
  const inside = !!cab?.inside;
  const weems = !tutorial ? hud.weems ?? null : null;
  const lens = playing && showPredictions ? hud.lens ?? null : null;
  const dying = !!hud.death;
  return (
    <div
      className={`mhud${hud.hidden ? ' is-hidden' : ''}${noiseFocus ? ' is-noise-focus' : ''}${tutorial ? ' is-tutorial' : ''}${dying ? ' is-dying' : ''}${inside ? ' is-in-cabinet' : ''}`}
      data-testid="mystery-hud"
    >
      {cab?.door && <CabinetOverlay v={cab} />}
      <div className="mhud-mist" data-mode={crackMist || slurpMist ? 'none' : hydeLive ? mode : 'none'} data-enemy={crackMist ? 'crackstone' : slurpMist ? 'slurp' : undefined} aria-hidden="true" />
      {hud.hidden && !inside && <div className="mhud-vignette" aria-hidden="true" />}
      {hud.catchFlashSeq > 0 && <div key={hud.catchFlashSeq} className="mhud-catch-flash" data-enemy={hud.catchTint ?? undefined} aria-hidden="true" />}
      {banner?.kind === 'curse_hit' && <div key={`curse${banner.id}`} className="mhud-curse-flash" aria-hidden="true" />}

      <ObjectivePanel hud={hud} tutorial={tutorial} />
      {weems && weems.button.state !== 'hidden' && <AskWeemsButton b={weems.button} onAsk={() => onAskWeems?.()} />}
      {hud.clueCard ? <ClueCard c={hud.clueCard} /> : weems?.card ? <WeemsCard c={weems.card} /> : null}

      <Compass feed={nav} />
      {playing && <ThreatsStrip chips={chips} />}
      {edge && <ThreatEdge e={edge} />}
      {banner && <TelegraphBanner b={banner} />}
      {!pointerLocked && !banner && !inside && !dying && <p className="mhud-lockhint" data-testid="hud-lockhint">Click to look around</p>}
      {hud.toast && !banner && <ToastView t={hud.toast} />}

      <div className="mhud-right">
        <Minimap feed={nav} />
        {lens && <LensBar lens={lens} />}
        {showPredictions && !tutorial && <OddsPanel odds={hud.odds} />}
        {!tutorial && <KeyLegend variant="strip" className="mhud-keystrip" data-testid="hud-keystrip" />}
      </div>

      {hud.examineToast ? <ExamineToast t={hud.examineToast} />
        : cab && (cab.chip || cab.prompt) ? <CabinetBlock v={cab} />
        : hud.prompt && (hud.prompt.kind as string) !== 'cabinet' ? <InteractPrompt prompt={hud.prompt} /> : null}
      {!inside && ((hud.power.aimed && hud.power.ready) || (hud.move.aimed && hud.move.ready)) ? <span className="mhud-reticle" aria-hidden="true" /> : null}

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

      <VitalsPanel hud={hud} tutorial={tutorial} />

      <section className={`mhud-abilities${inside ? ' is-inside' : ''}`} aria-label="Abilities">
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

/** The ONE chevron on the screen edge (§4 order); the Hyde's plain red / amber chevron, Crackstone's green + icon, Slurp's orchid. */
function ThreatEdge({ e }: { e: ThreatEdgeView }) {
  const style: CSSProperties = { left: `${e.at.x * 100}%`, top: `${e.at.y * 100}%`, transform: `translate(-50%, -50%) rotate(${e.at.rot}rad)` };
  return (
    <span
      className={`mhud-edge${e.strong ? ' is-chase' : ''}${e.enemy === 'crack' ? ' is-crack' : ''}${e.enemy === 'slurp' ? ' is-slurp' : ''}`}
      style={style} aria-hidden="true" data-testid="hud-threat-edge" data-enemy={e.enemy}
    >
      <Icon name="chevronUp" />
      {e.icon && <span className="mhud-edge__icon" style={{ transform: `rotate(${-e.at.rot}rad)` }}><HudIcon name={e.icon} /></span>}
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

function VitalsPanel({ hud, tutorial }: { hud: MysteryHudModel; tutorial: boolean }) {
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const low = hud.hp <= 35;
  const seg = Math.round(hud.noise.level * 10);
  return (
    <section className="mhud-panel mhud-vitals" aria-label="Your condition" data-testid="hud-vitals">
      <Icon name="barChart" className="mhud-vitals__layer" />
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
      {!tutorial && hud.tally && <TallyRow t={hud.tally} />}
      {hud.cursedLeftS !== null && (
        <p className="mhud-cursed" data-testid="hud-cursed">
          <Icon name="curse" />
          <span>CURSED · slowed <span className="num">{hud.cursedLeftS.toFixed(1)} s</span></span>
        </p>
      )}
      {hud.cabinet?.vitals ? (
        <p className="mhud-hidden mhud-hidden--cabinet" data-testid="hud-hidden">
          <HudIcon name="cabinet" />
          {hud.cabinet.vitals}
        </p>
      ) : hud.hidden && (
        <p className={`mhud-hidden${hud.tooClose ? ' is-close' : ''}`} data-testid="hud-hidden">
          <Icon name="eyeClosed" />
          {hud.tooClose ? 'Too close — it may spot you' : 'HIDDEN · it can still hear you'}
        </p>
      )}
    </section>
  );
}

/** Vitals row 3 (UX_FINAL §1b): TALLY · Seen n · Hits n · Hints n (rule events); each increment pulses once. */
function TallyRow({ t }: { t: NonNullable<MysteryHudModel['tally']> }) {
  const item = (k: 'seen' | 'hits' | 'hints', icon: 'eye' | 'shieldAlert' | 'ghost', label: string, n: number) => (
    <span key={`${k}${t.bump[k]}`} className={`mhud-tally__item${t.bump[k] > 0 ? ' is-bump' : ''}${n > 0 ? ' is-on' : ''}`} data-testid={`hud-tally-${k}`}>
      <Icon name={icon} />
      {label} <span className="num">{n}</span>
    </span>
  );
  return (
    <p className="mhud-tally" data-testid="hud-tally" aria-label={`Tally: seen ${t.seen}, hits ${t.hits}, hints ${t.hints}`}>
      <span className="caps mhud-tally__head">{TALLY_COPY.head}</span>
      {item('seen', 'eye', TALLY_COPY.seen, t.seen)}
      {item('hits', 'shieldAlert', TALLY_COPY.hits, t.hits)}
      {item('hints', 'ghost', TALLY_COPY.hints, t.hints)}
    </p>
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
