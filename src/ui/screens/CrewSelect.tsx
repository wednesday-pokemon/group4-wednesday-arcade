// Captain select (step 2 of 4, 4×3) and Pokémon select (step 3 of 4, 6×3).
import { useId, useRef, type ReactNode } from 'react';
import { CHARACTERS, CHARACTER_BY_ID, POKEMON } from '../../game/index.ts';
import type { CharacterId, PokemonId } from '../../game/index.ts';
import { announceSelection } from '../../app/announce.tsx';
import { useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { Button, Reason } from '../components/Button.tsx';
import { CaptainCardBody, PokemonCardBody } from '../components/CrewCards.tsx';
import { SelectGrid, type SelectGridHandle } from '../components/SelectGrid.tsx';

interface FrameProps {
  step: number;
  title: string;
  titleId: string;
  chip?: ReactNode;
  tools: ReactNode;
  selectedText: string | null;
  missingReason: string;
  onBack: () => void;
  onContinue: () => void;
  grid: ReactNode;
  gridRef: React.RefObject<SelectGridHandle | null>;
  testId: string;
  /** v3 screens: compact header + grid/detail split body. */
  className?: string;
  hint?: string;
}

export function SelectFrame({ step, title, titleId, chip, tools, selectedText, missingReason, onBack, onContinue, grid, gridRef, testId, className, hint }: FrameProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const reasonId = useId();
  useScreenFocus(h1);
  // Arrow keys from the heading jump into the grid (it is otherwise one Tab stop away).
  useHotkeys((key) => {
    const neutral = document.activeElement === h1.current || document.activeElement === document.body;
    if (neutral && key.startsWith('arrow')) {
      gridRef.current?.focus();
      return true;
    }
    if (neutral && key === 'enter' && selectedText) {
      onContinue();
      return true;
    }
  });
  return (
    <main className={`screen screen--select scrim-full${className ? ` ${className}` : ''}`} data-testid={testId}>
      <header className="select-head">
        <div>
          <p className="caps">Step {step} of 4</p>
          <h1 ref={h1} id={titleId} tabIndex={-1} className="display select-head__title">{title}</h1>
          <p className="text-2 select-head__hint">{hint ?? 'Arrows to browse · Enter to continue'}</p>
        </div>
        <div className="select-head__right">
          {chip}
          {tools}
        </div>
      </header>
      {grid}
      <footer className="select-foot">
        <div className="select-foot__continue">
          <Button
            variant="primary"
            size="lg"
            kbd="Enter"
            inactive={!selectedText}
            inactiveReason={missingReason}
            aria-describedby={!selectedText ? reasonId : undefined}
            onClick={onContinue}
            data-testid="btn-continue"
          >
            Continue
          </Button>
          {!selectedText && <Reason id={reasonId}>{missingReason}</Reason>}
        </div>
        <p className="select-foot__selected" aria-live="polite">
          {selectedText ? <>Selected: <strong>{selectedText}</strong></> : 'Nothing selected yet'}
        </p>
        <Button variant="ghost" onClick={onBack} className="select-foot__back" data-testid="btn-back">Back</Button>
      </footer>
    </main>
  );
}

interface CaptainProps {
  selectedId: CharacterId | null;
  tools: ReactNode;
  onSelect: (id: CharacterId) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function CaptainSelect({ selectedId, tools, onSelect, onBack, onContinue }: CaptainProps) {
  const titleId = useId();
  const gridRef = useRef<SelectGridHandle>(null);
  const selected = selectedId ? CHARACTER_BY_ID[selectedId] : null;
  return (
    <SelectFrame
      step={2}
      title="Choose your captain"
      titleId={titleId}
      tools={tools}
      selectedText={selected ? `${selected.name} · ${selected.abilityName}` : null}
      missingReason="Choose a captain first"
      onBack={onBack}
      onContinue={() => selectedId && onContinue()}
      gridRef={gridRef}
      testId="screen-captain"
      grid={
        <SelectGrid
          ref={gridRef}
          items={CHARACTERS}
          columns={4}
          selectedId={selectedId}
          labelledBy={titleId}
          onSelect={(id) => {
            onSelect(id);
            const c = CHARACTER_BY_ID[id];
            announceSelection(`${c.name}. ${c.abilityName}. ${c.shortAbility}`);
          }}
          onContinue={onContinue}
          renderCard={(c) => <CaptainCardBody character={c} />}
          describedBy={(c) => `ability-${c.id}`}
          label={(c) => `${c.name}, ${c.abilityName}`}
          testIdPrefix="captain"
        />
      }
    />
  );
}

interface PokemonProps {
  characterId: CharacterId;
  selectedId: PokemonId | null;
  tools: ReactNode;
  onSelect: (id: PokemonId) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function PokemonSelect({ characterId, selectedId, tools, onSelect, onBack, onContinue }: PokemonProps) {
  const titleId = useId();
  const gridRef = useRef<SelectGridHandle>(null);
  const captain = CHARACTER_BY_ID[characterId];
  const selected = POKEMON.find((p) => p.id === selectedId) ?? null;
  return (
    <SelectFrame
      step={3}
      title="Choose your ghost Pokémon"
      titleId={titleId}
      chip={<span className="chip">Captain: {captain.name} · {captain.abilityName}</span>}
      tools={tools}
      selectedText={selected ? `${selected.name} · ${selected.traitName}` : null}
      missingReason="Choose a Pokémon first"
      onBack={onBack}
      onContinue={() => selectedId && onContinue()}
      gridRef={gridRef}
      testId="screen-pokemon"
      grid={
        <SelectGrid
          ref={gridRef}
          items={POKEMON}
          columns={6}
          selectedId={selectedId}
          labelledBy={titleId}
          onSelect={(id) => {
            onSelect(id);
            const p = POKEMON.find((x) => x.id === id);
            if (p) announceSelection(`${p.name}. ${p.traitName}. ${p.shortTrait}`);
          }}
          onContinue={onContinue}
          renderCard={(p) => <PokemonCardBody pokemon={p} />}
          describedBy={(p) => `trait-${p.id}`}
          label={(p) => `${p.name}, ${p.traitName}`}
          testIdPrefix="pokemon"
        />
      }
    />
  );
}
