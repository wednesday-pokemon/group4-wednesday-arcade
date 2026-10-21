// Header utilities shared by every terminal screen: mode/connection badges, mute (M), fullscreen (F)
// and a display menu (reduced motion, high contrast, low graphics, optional Quit race).
import { useEffect, useRef, useState } from 'react';
import type { BackendMode, ConnectionState } from '../../lib/backend.ts';
import { toggleFullscreen, updateSettings, useSettings } from '../../app/settings.ts';
import { Icon } from '../Icon.tsx';
import { ConnectionBadge, ModeBadge } from './Badge.tsx';

interface HeaderToolsProps {
  mode: BackendMode;
  connection?: ConnectionState;
  onQuit?: () => void;
  compact?: boolean;
}

export function HeaderTools({ mode, connection, onQuit, compact }: HeaderToolsProps) {
  const settings = useSettings();
  return (
    <div className={`header-tools${compact ? ' header-tools--compact' : ''}`}>
      <ModeBadge mode={mode} />
      {mode === 'live' && connection && <ConnectionBadge state={connection} />}
      <button
        type="button"
        className="icon-btn"
        aria-pressed={settings.muted}
        aria-label={settings.muted ? 'Sound off (M)' : 'Sound on (M)'}
        title={settings.muted ? 'Sound off (M)' : 'Sound on (M)'}
        onClick={() => updateSettings({ muted: !settings.muted })}
        data-testid="btn-mute"
      >
        <Icon name={settings.muted ? 'mute' : 'volume'} />
      </button>
      <DisplayMenu onQuit={onQuit} />
      <button
        type="button"
        className="icon-btn"
        aria-label="Fullscreen (F)"
        title="Fullscreen (F)"
        onClick={() => void toggleFullscreen()}
        data-testid="btn-fullscreen"
      >
        <Icon name="maximize" />
      </button>
    </div>
  );
}

function DisplayMenu({ onQuit }: { onQuit?: () => void }) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const toggle = (label: string, key: 'reducedMotion' | 'highContrast' | 'lowGraphics', testId: string) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={settings[key]}
      className="menu__item"
      onClick={() => updateSettings({ [key]: !settings[key] })}
      data-testid={testId}
    >
      <span className="menu__check" aria-hidden="true">{settings[key] && <Icon name="check" />}</span>
      {label}
    </button>
  );

  return (
    <div
      className="menu-root"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Display options"
        title="Display options"
        onClick={() => setOpen((o) => !o)}
        data-testid="btn-display-menu"
      >
        <Icon name="settings" />
      </button>
      {open && (
        <div className="menu panel" role="menu" aria-label="Display options">
          {toggle('Reduced motion', 'reducedMotion', 'toggle-reduced-motion')}
          {toggle('High contrast', 'highContrast', 'toggle-high-contrast')}
          {toggle('Low graphics', 'lowGraphics', 'toggle-low-graphics')}
          {onQuit && (
            <button
              type="button"
              role="menuitem"
              className="menu__item menu__item--danger"
              onClick={() => {
                setOpen(false);
                onQuit();
              }}
              data-testid="btn-quit"
            >
              <span className="menu__check" aria-hidden="true"><Icon name="logOut" /></span>
              Quit race
            </button>
          )}
        </div>
      )}
    </div>
  );
}
