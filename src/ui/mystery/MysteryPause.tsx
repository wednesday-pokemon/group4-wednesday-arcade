// PauseOverlay (UX_MYSTERY §7): opened whenever pointer lock is lost (or Esc without a lock). The sim clock is stopped.
// [Resume — click to continue] re-requests pointer lock; on rejection it keeps showing "Click again to resume".
// Tabs: Controls (headed by the exact Stay Silent line) and Settings. [Leave the case] asks for confirmation.
import { useEffect, useId, useRef, useState } from 'react';
import { useModalPresence } from '../../app/keyboard.ts';
import { STAY_SILENT_LINE } from '../../app/mystery/thingLines.ts';
import { setMotionPref, updateSettings, useSettings, type Settings } from '../../app/settings.ts';
import { Button } from '../components/Button.tsx';

interface MysteryPauseProps {
  tutorial: boolean;
  powerName: string;
  moveName: string;
  /** Re-locks the pointer and resumes; resolves false when the browser rejected the lock. */
  onResume: () => Promise<boolean>;
  onSkipTutorial: () => void;
  onLeave: () => void;
}

export function controlsList(powerName: string, moveName: string): [string, string][] {
  return [
    ['W A S D', 'Move'],
    ['Mouse or ← → ↑ ↓', 'Look'],
    ['Shift', 'Sprint (LOUD)'],
    ['C', 'Crouch (quiet)'],
    ['E', 'Search / pick up / deposit'],
    ['Hold E', 'Set the egg down'],
    ['F', powerName],
    ['Q', moveName],
    ['Tab', 'Evidence board'],
    ['V', 'Ask Thing'],
    ['Esc', 'Pause'],
    ['M', 'Mute'],
  ];
}

export function MysteryPause({ tutorial, powerName, moveName, onResume, onSkipTutorial, onLeave }: MysteryPauseProps) {
  useModalPresence(true);
  const first = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'controls' | 'settings'>('controls');
  const [rejected, setRejected] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => first.current?.focus(), []);

  const resume = async () => {
    const ok = await onResume();
    if (!ok) setRejected(true);
  };

  return (
    <section className="mpause panel" role="dialog" aria-modal="true" aria-labelledby="mpause-title" data-testid="dialog-pause">
      <div className="mpause__main">
        <h2 id="mpause-title" className="mpause__title display">Paused · clock stopped</h2>
        <div className="mpause__actions">
          <Button ref={first} variant="primary" onClick={() => void resume()} data-testid="btn-resume">
            {rejected ? 'Click again to resume' : 'Resume — click to continue'}
          </Button>
          {tutorial && <Button variant="secondary" onClick={onSkipTutorial} data-testid="btn-pause-skip-tutorial">Skip tutorial</Button>}
          <Button variant="ghost" onClick={() => setConfirmLeave(true)} data-testid="btn-leave-case">Leave the case</Button>
        </div>
        <p className="text-2 mpause__hint">Esc also resumes (keyboard play without the mouse).</p>
        {confirmLeave && (
          <div className="mpause__confirm" role="alertdialog" aria-labelledby="leave-title" data-testid="leave-confirm">
            <p id="leave-title"><strong>This ends your run. It won’t appear on the leaderboard.</strong></p>
            <div className="button-row">
              <Button variant="danger" onClick={onLeave} data-testid="btn-leave-confirm">Leave the case</Button>
              <Button variant="ghost" onClick={() => setConfirmLeave(false)}>Keep playing</Button>
            </div>
          </div>
        )}
      </div>

      <div className="mpause__side">
        <div className="mpause__tabs" role="tablist" aria-label="Help and settings">
          <button type="button" role="tab" aria-selected={tab === 'controls'} className="mpause__tab" onClick={() => setTab('controls')} data-testid="tab-controls">Controls</button>
          <button type="button" role="tab" aria-selected={tab === 'settings'} className="mpause__tab" onClick={() => setTab('settings')} data-testid="tab-settings">Settings</button>
        </div>
        {tab === 'controls' ? <ControlsHelp powerName={powerName} moveName={moveName} /> : <SettingsPanel />}
      </div>
    </section>
  );
}

function ControlsHelp({ powerName, moveName }: { powerName: string; moveName: string }) {
  return (
    <div role="tabpanel" className="mpause__panel" data-testid="controls-help">
      <p className="mpause__silent">{STAY_SILENT_LINE}</p>
      <dl className="mpause__controls">
        {controlsList(powerName, moveName).map(([k, v]) => (
          <div key={k}><dt><kbd className="kcap">{k}</kbd></dt><dd>{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}

function SettingsPanel() {
  const s = useSettings();
  const sensId = useId();
  const choice = <K extends keyof Settings>(label: string, key: K, options: [Settings[K], string][], onPick?: (v: Settings[K]) => void) => (
    <div className="mpause__choice" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <span className="mpause__seg">
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={s[key] === v} onClick={() => (onPick ? onPick(v) : updateSettings({ [key]: v } as Partial<Settings>))}>
            {text}
          </button>
        ))}
      </span>
    </div>
  );
  return (
    <div role="tabpanel" className="mpause__panel mpause__settings" data-testid="settings-panel">
      <label htmlFor={sensId} className="mpause__slider">
        <span>Look sensitivity <span className="num">{s.lookSensitivity}</span></span>
        <input id={sensId} type="range" min={1} max={10} step={1} value={s.lookSensitivity}
          onChange={(e) => updateSettings({ lookSensitivity: Number(e.target.value) })} data-testid="input-sensitivity" />
      </label>
      {choice('Invert Y', 'invertY', [[false, 'Off'], [true, 'On']])}
      {choice('Crouch', 'crouchToggle', [[true, 'Toggle'], [false, 'Hold']])}
      {choice('Reduced motion', 'motionPref', [['system', 'System'], ['on', 'On'], ['off', 'Off']], (v) => setMotionPref(v))}
      {choice('Captions', 'captionSize', [['normal', 'Normal'], ['large', 'Large']])}
      {choice('Sound', 'muted', [[false, 'On'], [true, 'Muted']])}
      {choice('Risk estimate', 'showRisk', [[true, 'Show'], [false, 'Hide']])}
      {choice('High contrast', 'highContrast', [[false, 'Off'], [true, 'On']])}
    </div>
  );
}
