// Decision HUD (UX_SPEC §3): route cards left, advice + Raven Vision right, push + Set sail bottom,
// centre kept clear for the boat. Hotkeys: S/H route, 1/2/3 push, A use advice, Enter set sail.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { getPushOptions } from '../../game/index.ts';
import type { LegChoice, PushLevel, RouteId, SessionView } from '../../game/index.ts';
import { requestAdvice } from '../../analytics/adviceClient.ts';
import { RAVEN_VISION_MODEL } from '../../analytics/model.ts';
import { predictLeg, type LegPrediction } from '../../analytics/ravenVision.ts';
import { collectProbability } from '../../analytics/features.ts';
import { announce, announceSelection } from '../../app/announce.tsx';
import { useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import type { LegNotes } from '../../app/flow.ts';
import { Button, Reason } from '../components/Button.tsx';
import { fmtPct, routeName } from '../format.ts';
import { AdvicePanel, recommendedRisk, type AdviceStatus } from './AdvicePanel.tsx';
import { HudTopBar } from './HudTopBar.tsx';
import { PushGroup } from './PushGroup.tsx';
import { RavenVisionPanel } from './RavenVisionPanel.tsx';
import { RouteCard } from './RouteCard.tsx';
import { legalPushFor, previewRoute } from './routePreview.ts';

interface DecisionHudProps {
  view: SessionView;
  selection: { route: RouteId | null; pushLevel: PushLevel };
  busy: boolean;
  tools: ReactNode;
  onSelect: (patch: { route?: RouteId; pushLevel?: PushLevel }) => void;
  onSail: (notes: LegNotes) => void;
  onRoutePreview: (route: RouteId | null) => void;
  onAdvice: (status: AdviceStatus) => void;
}

const ROUTES: RouteId[] = ['safe', 'shortcut'];

function predict(view: SessionView, choice: LegChoice): LegPrediction {
  const { state, leg } = view;
  const known = leg!.visibleOffers[choice.route];
  return predictLeg(RAVEN_VISION_MODEL, state, leg!.weather, choice, collectProbability(state, choice.route, known));
}

export function DecisionHud({ view, selection, busy, tools, onSelect, onSail, onRoutePreview, onAdvice }: DecisionHudProps) {
  const { state } = view;
  const leg = view.leg!;
  const h1 = useRef<HTMLHeadingElement>(null);
  const sailRef = useRef<HTMLButtonElement>(null);
  const routeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sailReasonId = useId();
  const routeLabelId = useId();
  useScreenFocus(h1);

  const options = useMemo(() => getPushOptions(state), [state]);
  const [advice, setAdvice] = useState<AdviceStatus>({ kind: 'loading' });
  const [hover, setHover] = useState<{ route: RouteId | null; push: PushLevel | null }>({ route: null, push: null });

  useEffect(() => {
    let alive = true;
    setAdvice({ kind: 'loading' });
    requestAdvice('route', state, leg)
      .then((a) => {
        if (!alive) return;
        setAdvice({ kind: 'ready', advice: a });
        const risk = recommendedRisk(a);
        if (a.recommended) {
          announce(`Wednesday advises ${routeName(a.recommended.route)}, push ${a.recommended.pushLevel}.${risk !== null ? ` Race-ending risk ${Math.round(risk * 100)} percent.` : ''}`);
        }
      })
      .catch(() => alive && setAdvice({ kind: 'error' }));
    return () => {
      alive = false;
    };
    // Advice depends only on the canonical revision of this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId, state.revision]);

  useEffect(() => onAdvice(advice), [advice, onAdvice]);

  const advised = advice.kind === 'ready' ? advice.advice.recommended : null;
  const pushForPreview = legalPushFor(options, hover.push ?? selection.pushLevel);
  const previews = ROUTES.map((r) => previewRoute(state, leg.weather, r, pushForPreview, leg.visibleOffers[r]));

  const focusRoute = hover.route ?? selection.route;
  const visionChoice: LegChoice | null = focusRoute
    ? { route: focusRoute, pushLevel: pushForPreview }
    : advised ? { route: advised.route, pushLevel: advised.pushLevel } : null;
  const prediction = visionChoice ? predict(view, visionChoice) : null;
  const visionLabel = visionChoice
    ? `${focusRoute ? '' : 'Advised: '}${routeName(visionChoice.route)} · Push ${visionChoice.pushLevel}`
    : '';

  useEffect(() => onRoutePreview(selection.route ?? hover.route), [selection.route, hover.route, onRoutePreview]);

  const previewCost = options.find((o) => o.pushLevel === (hover.push ?? selection.pushLevel))?.staminaCost ?? 0;

  const choose = (patch: { route?: RouteId; pushLevel?: PushLevel }) => {
    const next = { route: patch.route ?? selection.route, pushLevel: patch.pushLevel ?? selection.pushLevel };
    onSelect(patch);
    if (next.route) {
      const p = predict(view, { route: next.route, pushLevel: next.pushLevel });
      announceSelection(`${routeName(next.route)}, push ${next.pushLevel}. Predicted leg time ${p.legTimeS.toFixed(2)} seconds. Catch chance ${fmtPct(p.catchP).replace('%', ' percent')}.`);
    }
  };

  const pushLegal = (level: PushLevel) => options.find((o) => o.pushLevel === level)?.isLegal ?? false;

  const applyAdvice = () => {
    if (!advised) return;
    choose({ route: advised.route, pushLevel: advised.pushLevel });
  };

  const sail = () => {
    if (!selection.route || busy) {
      if (!selection.route) announce('Choose a route first');
      return;
    }
    const choice = { route: selection.route, pushLevel: selection.pushLevel };
    const adv = advice.kind === 'ready' ? advice.advice : null;
    onSail({
      prediction: predict(view, choice),
      advice: adv,
      followedAdvice: adv?.recommended ? adv.recommended.route === choice.route && adv.recommended.pushLevel === choice.pushLevel : null,
    });
  };

  useHotkeys((key) => {
    if (key === 's' || key === 'h') {
      choose({ route: key === 's' ? 'safe' : 'shortcut' });
      return true;
    }
    if (key === '1' || key === '2' || key === '3') {
      const level = Number(key) as PushLevel;
      if (pushLegal(level)) choose({ pushLevel: level });
      else announce(options[level - 1].disabledReason ?? 'Not enough stamina');
      return true;
    }
    if (key === 'a') {
      applyAdvice();
      return true;
    }
    // Enter sails unless focus is on another button (which Enter activates natively).
    if (key === 'enter' && !(document.activeElement instanceof HTMLButtonElement)) {
      sail();
      return true;
    }
  });

  const onRouteKey = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (e.key === ' ') {
      e.preventDefault();
      choose({ route: ROUTES[i] });
      return;
    }
    if (!delta) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(1, i + delta));
    routeRefs.current[j]?.focus();
    choose({ route: ROUTES[j] });
  };

  return (
    <main className="screen screen--hud" data-testid="screen-decision">
      <h1 ref={h1} tabIndex={-1} className="sr-only">Leg {leg.legIndex}: {leg.legName}. Choose a route and push.</h1>
      <HudTopBar state={state} legIndex={leg.legIndex} legName={leg.legName} weather={leg.weather} previewCost={previewCost} tools={tools} />

      <section className="hud-left" aria-labelledby={routeLabelId}>
        <h2 id={routeLabelId} className="sr-only">Route</h2>
        <div role="radiogroup" aria-labelledby={routeLabelId} className="route-group">
          {previews.map((p, i) => (
            <RouteCard
              key={p.route}
              ref={(el) => {
                routeRefs.current[i] = el;
              }}
              preview={p}
              weather={leg.weather}
              pokemonId={state.pokemonId}
              pushLevel={pushForPreview}
              selected={selection.route === p.route}
              advised={advised?.route === p.route}
              tabbable={selection.route ? selection.route === p.route : i === 0}
              onSelect={() => choose({ route: p.route })}
              onHover={(on) => setHover((h) => ({ ...h, route: on ? p.route : null }))}
              onKeyDown={(e) => onRouteKey(e, i)}
            />
          ))}
        </div>
      </section>

      <aside className="hud-right">
        <AdvicePanel status={advice} onUse={applyAdvice} />
        <RavenVisionPanel prediction={prediction} choice={visionChoice} label={visionLabel} />
      </aside>

      <footer className="hud-bottom panel">
        <PushGroup
          options={options}
          selected={selection.pushLevel}
          advised={advised?.pushLevel ?? null}
          onSelect={(level) => choose({ pushLevel: level })}
          onHover={(level) => setHover((h) => ({ ...h, push: level }))}
        />
        <div className="hud-bottom__sail">
          <Button
            ref={sailRef}
            variant="primary"
            size="lg"
            kbd="Enter"
            className="btn--sail"
            inactive={!selection.route}
            inactiveReason="Choose a route first"
            aria-describedby={!selection.route ? sailReasonId : undefined}
            busy={busy}
            busyLabel="Raising sails…"
            onClick={sail}
            data-testid="btn-set-sail"
          >
            Set sail
          </Button>
          {!selection.route && <Reason id={sailReasonId}>Choose a route first</Reason>}
        </div>
      </footer>
    </main>
  );
}
