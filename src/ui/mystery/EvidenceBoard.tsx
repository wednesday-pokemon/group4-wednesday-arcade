// Tab "Investigation" overlay (docs/overhaul/UX_OVERHAUL.md §4; rulings R2, R3). Replaces the old review-mode board.
//
// REVIEW (Tab during play; the sim + clock are paused; Tab / Esc close it). Three columns at 1366×768:
//   1 EVIDENCE — three EvidenceSlots (found: title, TL;DR line, Meaning:, Mentions chips; Enter expands the full text.
//     Locked: "EVIDENCE 2 — not found" + "Search: <areas still to search> · N spots left"), SUSPECTS rows (Enter
//     expands the statement), a collapsed "Case-file notes (2)" row.
//   2 MAP — north-up investigation map with layer toggles 1 Hyde zones · 2 Egg sites · 3 Clue areas (keys 1/2/3).
//   3 THE ODDS — Hyde zones / spawns, egg sites + history line, clue areas, tower + detection, each with its exact
//     source label; 5 % rounding (largest remainder for distributions), bands, facts as words (odds.ts).
//   Hovering / focusing an odds row highlights its map item and a locked slot outlines its search areas.
// ACCUSATION (auto after the deposit; focus trap, Esc inert, nothing closes it). Column 2 becomes the SUSPECTS
//   (role=radio cards), column 3 the step panel; NO probabilities anywhere. R3: naming a suspect needs all clues —
//   with fewer the panel offers only "Leave the case unsolved" + "Find all 3 clues to accuse.". Step 2: "Cite"
//   checkboxes on the found slots + the two case-file notes as citable rows; then the one-shot confirm (unchanged).
// SECRECY: public data only (CaseDef + CaseWorldDef + InvestigationState + LiveForecasts). No guilt links, no culprit
// wording in clue copy, identical suspect cards; locked slots name candidate AREAS, never the drawn site.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { citableEvidence, sanitizeEvidence } from '../../mystery/caseLogic.ts';
import { caseWorld } from '../../mystery/data/caseWorlds.ts';
import type { LiveForecasts } from '../../mystery/analytics/types.ts';
import type {
  Accusation, CaseDef, CaseWorldDef, ClueDef, ClueId, EggState, InvestigationState, RoomId, SuspectDef, SuspectId,
} from '../../mystery/types.ts';
import { useModalPresence } from '../../app/keyboard.ts';
import { Button } from '../components/Button.tsx';
import { Icon, type IconName } from '../Icon.tsx';
import {
  canNameSuspect, evidenceSlots, mentionNames, ODDS_FOOTER, oddsBlocks, type EvidenceSlot, type FoundSlot, type LockedSlot, type MapRef,
  type OddsBlockView, type OddsRowView,
} from './investigationView.ts';
import { InvestigationMap, type MapLayers } from './InvestigationMap.tsx';
import type { PublicMapState } from './map/mapData.ts';
import '../styles/investigation.css';

export interface EvidenceBoardProps {
  caseDef: CaseDef;
  cluesFound: readonly ClueId[];
  /** Legacy fallback room label (kept for PlayView; the map takes room names from mapState). */
  roomName: (id: RoomId) => string;
  mode: 'review' | 'accuse';
  onClose: () => void;
  /** suspectId null = leave the case unsolved (evidence is then empty). Called exactly once. */
  onAccuse: (a: Accusation) => void;
  // ---- overhaul, all optional (the overlay degrades gracefully without them)
  /** The public map state PlayView builds for the minimap (map/mapData.ts) — drives the north-up Tab map. */
  mapState?: PublicMapState | null;
  /** The case world (areas, candidate sites, zones, spawns) — public design data. Default: mapState.world. */
  world?: CaseWorldDef | null;
  /** What the player has observed (run.investigation()). Default: mapState.investigation. */
  investigation?: InvestigationState | null;
  /** The analytics layer's live forecasts (analytics.live().forecasts). Default: mapState.forecasts. */
  forecasts?: LiveForecasts | null;
  /** Egg state (carried / delivered replace the egg odds with a fact). Default: mapState.eggState. */
  eggState?: EggState | null;
  /** Settings → "Predictions" (settings.showRisk). Off: no odds column, no map tints / %. Default true. */
  showPredictions?: boolean;
}

const ENTER_GUARD_MS = 500;
const FOCUSABLE = 'button:not([disabled]), [role="radio"][tabindex="0"], input:not([disabled])';
/** Arrow-key list items inside a column (UX §11: ↑↓ lists, Enter expands). */
const NAV_ITEMS = '.inv-slot__btn, .suspect__btn, .inv-notes__toggle, .inv-orow[tabindex], .inv-cite input';

export type AccuseStep = 'suspect' | 'evidence';

export interface EvidenceOption { id: string; kind: 'clue' | 'note'; title: string }

/** The checklist for step 2: found clues (case order) then the two case-file notes (pure; unit-tested). */
export function evidenceOptions(caseDef: CaseDef, cluesFound: readonly ClueId[]): EvidenceOption[] {
  return citableEvidence(caseDef, cluesFound).map((id) => {
    const clue = caseDef.clues.find((c) => c.id === id);
    if (clue) return { id, kind: 'clue', title: clue.title };
    const note = caseDef.notes.find((n) => n.id === id);
    return { id, kind: 'note', title: note?.title ?? id };
  });
}

/** The board's footnote already says jobs are invented for this story, so the per-role suffix is dropped (pure). */
export function shortRole(role: string): string {
  return role.replace(/\s*\(role in this story\)\s*$/i, '');
}

/** Names mentioned in a clue's text, in suspect order (neutral; pure). */
export function mentionedNames(caseDef: CaseDef, clue: ClueDef): string[] {
  return mentionNames(caseDef, clue);
}

const ALL_LAYERS: MapLayers = { zones: true, egg: true, clues: true, crack: true };

export function EvidenceBoard(p: EvidenceBoardProps) {
  const { caseDef, cluesFound: found, mode, onClose, onAccuse } = p;
  useModalPresence(true);
  const showPredictions = p.showPredictions ?? true;
  const root = useRef<HTMLElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const [choice, setChoice] = useState<SuspectId | null>(null);
  const [step, setStep] = useState<AccuseStep>('suspect');
  const [cited, setCited] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<'accuse' | 'unsolved' | null>(null);
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState<ClueId | null>(null);
  const [layers, setLayers] = useState<MapLayers>(ALL_LAYERS);
  const [hover, setHover] = useState<MapRef | null>(null);
  const [focusSlot, setFocusSlot] = useState<LockedSlot | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openConfirm = (kind: 'accuse' | 'unsolved') => {
    opener.current = document.activeElement as HTMLElement | null;
    setConfirm(kind);
  };
  const closeConfirm = () => {
    setConfirm(null);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  };
  const accuse = mode === 'accuse';
  const gated = accuse && !canNameSuspect(caseDef, found);
  const options = evidenceOptions(caseDef, found);
  const nameOf = (id: SuspectId) => caseDef.suspects.find((s) => s.id === id)?.name ?? id;
  // The case world is public design data: without a passed one, the case's own world still names the search areas.
  const world = p.world ?? p.mapState?.world ?? caseWorld(caseDef.id) ?? null;
  const investigation = p.investigation ?? p.mapState?.investigation ?? null;
  const forecasts = p.forecasts ?? p.mapState?.forecasts ?? null;
  const eggState = p.eggState ?? p.mapState?.eggState ?? null;
  /** Joseph Crackstone in this case (public design data): layer toggle 4 + legend + "Will Crackstone see you?". */
  const hasCrack = !!(p.mapState?.crack ?? world?.crackstone);
  const slots = evidenceSlots(caseDef, found, world, investigation);
  const total = caseDef.clues.length;
  const citing = accuse && step === 'evidence';

  useEffect(() => {
    const target = accuse
      ? (root.current?.querySelector<HTMLElement>('[role="radio"]') ?? root.current?.querySelector<HTMLElement>('[data-testid="btn-leave-unsolved"]'))
      : first.current;
    target?.focus({ preventScroll: true });
  }, [accuse]);
  // Step changes move focus to the step's first control (never lost to <body>).
  const stepMounted = useRef(false);
  useEffect(() => {
    if (!stepMounted.current) {
      stepMounted.current = true;
      return;
    }
    const sel = step === 'evidence' ? '.inv-cite input' : '[role="radio"][tabindex="0"]';
    root.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
  }, [step]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // ↑ / ↓ move through a column's list (slots → suspects → notes; odds rows). Radios handle their own arrows.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.defaultPrevented) {
      const here = document.activeElement as HTMLElement | null;
      const col = here?.closest<HTMLElement>('.inv__col');
      if (col && here && here.matches(NAV_ITEMS)) {
        const items = [...col.querySelectorAll<HTMLElement>(NAV_ITEMS)].filter((el) => el.offsetParent !== null);
        const i = items.indexOf(here);
        const next = items[e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)];
        if (next && next !== here) next.focus();
        e.preventDefault();
        return;
      }
    }
    // Layer toggles 1 / 2 / 3 (review map), unless typing in a field.
    if (!accuse && !e.altKey && !e.ctrlKey && !e.metaKey && (['1', '2', '3'].includes(e.key) || (e.key === '4' && hasCrack))) {
      const k = (['zones', 'egg', 'clues', 'crack'] as const)[Number(e.key) - 1]!;
      setLayers((l) => ({ ...l, [k]: !l[k] }));
      e.preventDefault();
      return;
    }
    // Focus trap in accusation mode: Tab cycles inside the board (or inside the open confirm dialog).
    if (!accuse || e.key !== 'Tab') return;
    const scope = root.current?.querySelector<HTMLElement>('.board__confirm') ?? root.current;
    const items = [...(scope?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
    items[next]?.focus();
  };

  const toggle = (id: string) => setCited((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const evidence = sanitizeEvidence(caseDef, found, cited);
  const commit = () => {
    if (done) return;
    setDone(true);
    onAccuse(confirm === 'unsolved' || choice === null || gated ? { suspectId: null, evidence: [] } : { suspectId: choice, evidence });
  };

  const blocks = useMemo(
    () => (accuse ? [] : oddsBlocks({ forecasts, world, investigation, cluesFound: found, clueTotal: total, eggState })),
    [accuse, forecasts, world, investigation, found, total, eggState],
  );
  const highlight: MapRef[] = hover ? [hover] : focusSlot ? focusSlot.areaIds.map((id) => ({ kind: 'area' as const, id })) : [];

  return (
    <section
      ref={root}
      className={`inv inv--${mode}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="board-title"
      data-testid="evidence-board"
      data-mode={mode}
      data-case={caseDef.id}
      data-step={accuse ? step : undefined}
      onKeyDown={onKeyDown}
    >
      <header className="inv__head">
        <div className="inv__heading">
          <p className="inv__kicker caps">Case {caseDef.number} · {caseDef.title}</p>
          <h2 id="board-title" className="inv__title">{accuse ? 'Name the culprit' : 'Investigation'}</h2>
        </div>
        <div className="inv__meta">
          <span className="inv__pips" role="img" aria-label={`${found.length} of ${total} clues found`}>
            {caseDef.clues.map((c) => <span key={c.id} className={`inv__pip${found.includes(c.id) ? ' is-on' : ''}`} />)}
          </span>
          <p className="inv__count">{found.length} of {total} clues found</p>
          <p className="inv__victim">Victim: {caseDef.victim}</p>
          {!accuse && <Button ref={first} variant="secondary" size="sm" kbd="Tab" onClick={onClose} data-testid="btn-board-close">Close</Button>}
        </div>
      </header>

      <div className="inv__body">
        {/* ---------------------------------------------------------------- column 1: evidence */}
        <section className="inv__col inv__col--evidence" aria-labelledby="board-evidence">
          <h3 id="board-evidence" className="sr-only">Evidence</h3>
          <ul className="board__clues inv-slots" data-expanded={expanded ?? undefined}>
            {slots.map((s) => (
              <SlotItem
                key={s.clueId}
                slot={s}
                expanded={expanded === s.clueId}
                collapsed={expanded !== null && expanded !== s.clueId}
                onToggle={() => setExpanded((e) => (e === s.clueId ? null : s.clueId))}
                onFocusLocked={(l) => setFocusSlot(l)}
                cite={citing && s.kind === 'found' ? { checked: cited.includes(s.clueId), onChange: () => toggle(s.clueId), disabled: done } : null}
              />
            ))}
          </ul>

          {citing ? (
            <section className="inv-citenotes" aria-labelledby="board-notes">
              <h3 id="board-notes" className="inv__label caps">Case-file notes</h3>
              <ul className="inv-citenotes__list">
                {caseDef.notes.map((n) => (
                  <li key={n.id} className="inv-citenote" data-testid={`note-${n.id}`}>
                    <label className="inv-cite inv-cite--row">
                      <input type="checkbox" checked={cited.includes(n.id)} onChange={() => toggle(n.id)} disabled={done} data-testid={`evidence-option-${n.id}`} />
                      <span className="inv-cite__box" aria-hidden="true"><Icon name="check" /></span>
                      <span className="inv-citenote__text"><strong>{n.title}</strong> <span>{n.text}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <>
              <section className="inv-suspects" aria-labelledby="board-suspects">
                <h3 id="board-suspects" className="inv__label caps">Suspects</h3>
                <ul className="board__suspects inv-suspects__list">
                  {caseDef.suspects.map((s) => <SuspectRow key={s.id} s={s} />)}
                </ul>
              </section>
              <NotesRow caseDef={caseDef} />
            </>
          )}
        </section>

        {/* ---------------------------------------------------------------- column 2: map / suspects */}
        {accuse ? (
          <section className="inv__col inv__col--suspects" aria-labelledby="accuse-q">
            <SuspectPicker
              suspects={caseDef.suspects}
              value={choice}
              onChange={setChoice}
              interactive={!gated}
              disabled={done || step === 'evidence'}
            />
          </section>
        ) : (
          <section className="inv__col inv__col--map" aria-labelledby="board-map">
            <h3 id="board-map" className="sr-only">Investigation map (north up)</h3>
            <div className="inv-layers" role="group" aria-label="Map layers">
              <LayerToggle n={1} label={hasCrack ? 'Hyde' : 'Hyde zones'} on={layers.zones} tone="hyde" onClick={() => setLayers((l) => ({ ...l, zones: !l.zones }))} />
              <LayerToggle n={2} label={hasCrack ? 'Egg' : 'Egg sites'} on={layers.egg} tone="egg" onClick={() => setLayers((l) => ({ ...l, egg: !l.egg }))} />
              <LayerToggle n={3} label={hasCrack ? 'Clues' : 'Clue areas'} on={layers.clues} tone="clue" onClick={() => setLayers((l) => ({ ...l, clues: !l.clues }))} />
              {hasCrack && <LayerToggle n={4} label="Crackstone" on={layers.crack !== false} tone="crack" onClick={() => setLayers((l) => ({ ...l, crack: l.crack === false }))} />}
            </div>
            <InvestigationMap state={p.mapState ?? null} layers={layers} highlight={highlight} onHover={setHover} showPredictions={showPredictions} />
            {hasCrack && (
              <ul className="inv-legend" aria-label="Map legend" data-testid="inv-legend">
                <li><span className="inv-legend__sw inv-legend__sw--hyde" aria-hidden="true" />Hyde likely here · Bayesian estimate</li>
                <li><span className="inv-legend__sw inv-legend__sw--crack" aria-hidden="true" />Crackstone may see this spot (next 10 s) · Rule-based estimate</li>
                <li><span className="inv-legend__sw inv-legend__sw--area" aria-hidden="true" />Cursed area</li>
              </ul>
            )}
          </section>
        )}

        {/* ---------------------------------------------------------------- column 3: odds / steps */}
        {accuse ? (
          <section className="inv__col inv__col--steps">
            <div className="accuse-panel inv-steps" data-testid="accuse-panel" data-step={gated ? 'gated' : step}>
              {gated ? (
                <>
                  <p className="inv-steps__q display" id="accuse-q">Who released the Hyde?</p>
                  <p className="inv-steps__gate"><Icon name="lock" /> Find all {total} clues to accuse.</p>
                  <p className="inv-steps__help">You found {found.length} of {total}. Your egg still counts.</p>
                  <div className="inv-steps__actions">
                    <Button variant="primary" inactive={done} onClick={() => openConfirm('unsolved')} data-testid="btn-leave-unsolved">Leave the case unsolved</Button>
                  </div>
                </>
              ) : step === 'suspect' ? (
                <>
                  <p className="inv-steps__step caps">Step 1 of 2</p>
                  <p className="inv-steps__q display" id="accuse-q">Who released the Hyde?</p>
                  <p className="inv-steps__help">Choose a suspect. Read their statements and your evidence.</p>
                  <div className="inv-steps__actions">
                    <Button
                      variant="primary"
                      inactive={choice === null || done}
                      inactiveReason="Choose a suspect first."
                      onClick={() => choice && setStep('evidence')}
                      data-testid="btn-accuse"
                    >
                      {choice ? `Accuse ${nameOf(choice)}…` : 'Accuse…'}
                    </Button>
                    <Button variant="ghost" inactive={done} onClick={() => openConfirm('unsolved')} data-testid="btn-leave-unsolved">Leave the case unsolved</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="inv-steps__step caps">Step 2 of 2</p>
                  <p className="inv-steps__q display" id="accuse-q">Which evidence supports accusing {choice ? nameOf(choice) : ''}?</p>
                  <p className="inv-steps__help">Tick <strong>Cite</strong> on your evidence and notes.</p>
                  <p id="evidence-reason" className="inv-steps__count" aria-live="polite">
                    {evidence.length === 0 ? 'Cite at least one piece of evidence.' : `${evidence.length} cited`}
                  </p>
                  <div className="inv-steps__actions">
                    <Button variant="ghost" inactive={done} onClick={() => setStep('suspect')} data-testid="btn-accuse-back">Change suspect</Button>
                    <Button
                      variant="primary"
                      inactive={evidence.length === 0 || done}
                      inactiveReason="Cite at least one piece of evidence."
                      aria-describedby="evidence-reason"
                      onClick={() => evidence.length > 0 && openConfirm('accuse')}
                      data-testid="btn-accuse-next"
                    >
                      Continue
                    </Button>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : (
          <section className="inv__col inv__col--odds" aria-labelledby="board-odds">
            <h3 id="board-odds" className="inv__label caps">The odds</h3>
            {showPredictions ? (
              <>
                <div className="inv-odds">
                  {blocks.map((b) => <OddsBlock key={b.id} b={b} hover={hover} onHover={setHover} />)}
                </div>
                <p className="inv-odds__foot">{ODDS_FOOTER}</p>
              </>
            ) : (
              <p className="inv-odds__off" data-testid="odds-off">Predictions are off. Turn them on in Pause → Settings.</p>
            )}
          </section>
        )}
      </div>

      <footer className="inv__foot">
        {!accuse && (
          <div className="inv__accuse">
            <Button variant="secondary" size="sm" inactive inactiveReason="Deliver the egg first." aria-describedby="accuse-locked-reason">Accuse at Iago Tower</Button>
            <p id="accuse-locked-reason" className="inv__reason">Deliver the egg first.</p>
          </div>
        )}
        <p className="board__note inv__note">Jobs and events are invented for this game’s story.</p>
      </footer>

      {confirm !== null && !done && (
        <AccuseConfirm
          title={confirm === 'unsolved' ? 'Leave the case unsolved?' : `Accuse ${choice ? nameOf(choice) : ''}?`}
          body={confirm === 'unsolved'
            ? 'Your egg still counts. The mystery stays open. You can decide only once.'
            : `Citing ${evidence.length} piece${evidence.length === 1 ? '' : 's'} of evidence · ${found.length} of ${total} clues found. You can accuse only once.`}
          cited={confirm === 'accuse' ? options.filter((o) => evidence.includes(o.id)).map((o) => o.title) : []}
          confirmLabel={confirm === 'unsolved' ? 'Leave it unsolved' : 'Accuse'}
          onConfirm={commit}
          onReview={closeConfirm}
        />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------- column 1

interface CiteProps { checked: boolean; onChange: () => void; disabled: boolean }

function SlotItem({ slot, expanded, collapsed, onToggle, onFocusLocked, cite }: {
  slot: EvidenceSlot; expanded: boolean; collapsed: boolean; onToggle: () => void; onFocusLocked: (s: LockedSlot | null) => void; cite: CiteProps | null;
}) {
  const n = slot.index + 1;
  if (slot.kind === 'locked') {
    return (
      <li className="inv-slot inv-slot--locked" data-testid={`clue-${slot.clueId}`} data-found="false" data-spotted={slot.spotted || undefined}>
        <button
          type="button"
          className="inv-slot__btn"
          onFocus={() => onFocusLocked(slot)}
          onBlur={() => onFocusLocked(null)}
          onMouseEnter={() => onFocusLocked(slot)}
          onMouseLeave={() => onFocusLocked(null)}
          aria-label={`Evidence ${n} — not found. ${slot.search}`}
        >
          <span className="inv-slot__icon inv-slot__icon--locked" aria-hidden="true"><Icon name="lock" /></span>
          <span className="inv-slot__main">
            <span className="inv-slot__kicker caps">Evidence {n} — not found</span>
            <span className="inv-slot__search">{slot.search}</span>
          </span>
        </button>
      </li>
    );
  }
  return <FoundSlotItem slot={slot} n={n} expanded={expanded} collapsed={collapsed} onToggle={onToggle} cite={cite} />;
}

function FoundSlotItem({ slot, n, expanded, collapsed, onToggle, cite }: {
  slot: FoundSlot; n: number; expanded: boolean; collapsed: boolean; onToggle: () => void; cite: CiteProps | null;
}) {
  const detailId = `inv-slot-${slot.clueId}-more`;
  return (
    <li
      className={`inv-slot inv-slot--found${expanded ? ' is-expanded' : ''}${collapsed ? ' is-collapsed' : ''}${cite ? ' has-cite' : ''}`}
      data-testid={`clue-${slot.clueId}`}
      data-found="true"
    >
      <button type="button" className="inv-slot__btn" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>
        <span className="inv-slot__icon" aria-hidden="true"><Icon name={slot.icon as IconName} /></span>
        <span className="inv-slot__main">
          <span className="inv-slot__kicker caps">Evidence {n}</span>
          <span className="inv-slot__title">{slot.title}</span>
        </span>
      </button>
      <div className="inv-slot__body">
        <p className="inv-slot__short">{slot.short}</p>
        <p className="inv-slot__meaning"><em>Meaning:</em> {slot.meaning}</p>
        {slot.mentions.length > 0 && (
          <p className="inv-slot__mentions">
            <span className="inv-slot__mlabel">Mentions:</span>
            {slot.mentions.map((m) => <span key={m} className="inv-chip">{m}</span>)}
          </p>
        )}
        <div id={detailId} className="inv-slot__more" hidden={!expanded}>
          <p className="inv-slot__text">{slot.text}</p>
          <p className="inv-slot__deduction"><em>Takeaway:</em> {slot.deduction}</p>
        </div>
      </div>
      {cite && (
        <label className="inv-cite inv-cite--slot">
          <input type="checkbox" checked={cite.checked} onChange={cite.onChange} disabled={cite.disabled} data-testid={`evidence-option-${slot.clueId}`} />
          <span className="inv-cite__box" aria-hidden="true"><Icon name="check" /></span>
          <span className="inv-cite__label">Cite</span>
        </label>
      )}
    </li>
  );
}

function SuspectRow({ s }: { s: SuspectDef }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="suspect" data-testid={`suspect-${s.id}`}>
      <button type="button" className={`suspect__btn${open ? ' is-open' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="suspect__cameo" aria-hidden="true">{s.name.slice(0, 1)}</span>
        <span className="suspect__body">
          <span className="suspect__line"><span className="suspect__name">{s.name}</span> <span className="suspect__role">{shortRole(s.role)}</span></span>
          <span className="suspect__context">{s.alibiOrContext}</span>
        </span>
      </button>
    </li>
  );
}

function NotesRow({ caseDef }: { caseDef: CaseDef }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (open) listRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  return (
    <section className={`inv-notes${open ? ' is-open' : ''}`} aria-labelledby="board-notes">
      <button type="button" className="inv-notes__toggle" aria-expanded={open} aria-controls="inv-notes-list" onClick={() => setOpen((o) => !o)}>
        <Icon name="fileText" />
        <span id="board-notes">Case-file notes ({caseDef.notes.length})</span>
        <span className="inv-notes__chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <ul id="inv-notes-list" ref={listRef} className="board__notes inv-notes__list" hidden={!open}>
        {caseDef.notes.map((n) => (
          <li key={n.id} className="note" data-testid={`note-${n.id}`}>
            <p className="note__title">{n.title}</p>
            <p className="note__text">{n.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------- column 2

function LayerToggle({ n, label, on, tone, onClick }: { n: number; label: string; on: boolean; tone: 'hyde' | 'egg' | 'clue' | 'crack'; onClick: () => void }) {
  return (
    <button type="button" className={`inv-layer inv-layer--${tone}`} aria-pressed={on} onClick={onClick} data-testid={`layer-${n}`}>
      <kbd className="kcap">{n}</kbd>
      <span className="inv-layer__swatch" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Accusation column 2: three identical suspect cards (role=radio when naming is allowed). No probabilities. */
function SuspectPicker({ suspects, value, onChange, interactive, disabled }: {
  suspects: SuspectDef[]; value: SuspectId | null; onChange: (s: SuspectId) => void; interactive: boolean; disabled: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, suspects.findIndex((s) => s.id === value));
  const move = (d: number) => {
    const n = (idx + d + suspects.length) % suspects.length;
    onChange(suspects[n]!.id);
    refs.current[n]?.focus();
  };
  const card = (s: SuspectDef): ReactNode => (
    <>
      <span className="inv-pick__cameo" aria-hidden="true">{s.name.slice(0, 1)}</span>
      <span className="inv-pick__body">
        <span className="inv-pick__name">{s.name}</span>
        <span className="inv-pick__role">{shortRole(s.role)}</span>
        <span className="inv-pick__statement">“{s.alibiOrContext.replace(/^[“"]|[”"]$/g, '')}”</span>
      </span>
    </>
  );
  if (!interactive) {
    return (
      <ul className="inv-pick inv-pick--locked" aria-label="Suspects">
        {suspects.map((s) => <li key={s.id} className="inv-pick__card">{card(s)}</li>)}
      </ul>
    );
  }
  return (
    <div className="inv-pick" role="radiogroup" aria-labelledby="accuse-q">
      {suspects.map((s, i) => (
        <button
          key={s.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          tabIndex={i === idx ? 0 : -1}
          disabled={disabled}
          className="inv-pick__card"
          onClick={() => onChange(s.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              move(1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(-1);
            }
          }}
          data-testid={`radio-${s.id}`}
        >
          <span className="inv-pick__dot" aria-hidden="true" />
          {card(s)}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------------------------------- column 3

const BLOCK_ICON: Record<OddsBlockView['id'], IconName> = { hyde: 'claw', egg: 'egg', clues: 'search', tower: 'gauge', crack: 'hat' };

function sameRef(a: MapRef | null, b: MapRef | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

function OddsBlock({ b, hover, onHover }: { b: OddsBlockView; hover: MapRef | null; onHover: (r: MapRef | null) => void }) {
  return (
    <section className={`inv-oblock inv-oblock--${b.id}`} aria-labelledby={`odds-${b.id}`} data-testid={`odds-${b.id}`}>
      <p className="inv-oblock__q" id={`odds-${b.id}`}>
        <Icon name={BLOCK_ICON[b.id]} />
        <span>{b.question}</span>
        {b.note && <span className="inv-oblock__note">{b.note}</span>}
      </p>
      {b.fact ? (
        <p className="inv-oblock__fact">{b.fact}</p>
      ) : (
        <ul className="inv-orows">
          {b.rows.map((r) => <OddsRow key={r.key} r={r} active={sameRef(r.ref, hover)} onHover={onHover} />)}
        </ul>
      )}
      {b.history && <p className="inv-oblock__history" data-testid={`odds-${b.id}-history`}>{b.history}</p>}
      <p className="inv-oblock__source">{b.source}</p>
    </section>
  );
}

function OddsRow({ r, active, onHover }: { r: OddsRowView; active: boolean; onHover: (ref: MapRef | null) => void }) {
  const enter = () => r.ref && onHover(r.ref);
  const leave = () => onHover(null);
  return (
    <li
      className={`inv-orow inv-orow--${r.tone}${r.top ? ' is-top' : ''}${r.pct === null ? ' is-fact' : ''}${active ? ' is-active' : ''}`}
      tabIndex={r.ref ? 0 : undefined}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      data-ref={r.ref ? `${r.ref.kind}:${r.ref.id}` : undefined}
    >
      <span className="inv-orow__name">{r.name}</span>
      <span className="inv-orow__track" aria-hidden="true">{r.pct !== null && <span style={{ width: `${Math.max(2, r.pct)}%` }} />}</span>
      <span className="inv-orow__val">{r.value}</span>
      <span className="inv-orow__band">{r.bandText ?? ''}</span>
    </li>
  );
}

// ----------------------------------------------------------------------------------------------------- confirm

function AccuseConfirm({ title, body, cited, confirmLabel, onConfirm, onReview }: {
  title: string; body: string; cited: string[]; confirmLabel: string; onConfirm: () => void; onReview: () => void;
}) {
  const review = useRef<HTMLButtonElement>(null);
  const mountedAt = useRef(performance.now());
  useEffect(() => review.current?.focus(), []);
  return (
    <div className="board__confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" data-testid="accuse-confirm"
      onKeyDownCapture={(e) => {
        // Enter is ignored for 500 ms so a held key never confirms by accident.
        if (e.key === 'Enter' && performance.now() - mountedAt.current < ENTER_GUARD_MS) e.preventDefault();
      }}
    >
      <div className="board__confirm-box panel">
        <h3 id="confirm-title" className="board__confirm-title display">{title}</h3>
        <p id="confirm-body" className="text-2">{body}</p>
        {cited.length > 0 && (
          <ul className="board__confirm-cited" aria-label="Evidence you cite">
            {cited.map((t) => <li key={t}><Icon name="check" /> {t}</li>)}
          </ul>
        )}
        <div className="button-row">
          <Button variant="primary" onClick={onConfirm} data-testid="btn-accuse-confirm">{confirmLabel}</Button>
          <Button ref={review} variant="ghost" onClick={onReview} data-testid="btn-accuse-review">Review evidence</Button>
        </div>
      </div>
    </div>
  );
}
