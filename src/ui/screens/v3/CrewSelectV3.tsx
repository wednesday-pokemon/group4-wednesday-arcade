// v3 crew selection (UX_V3_ACTION §5): Characters 4×3 and Pokémon 6×3 compact cards + a detail panel that follows
// keyboard focus / the selection. Reuses SelectFrame + SelectGrid (roving radiogroup, arrows select, Enter continues).
import { useId, useRef, useState, type ReactNode } from 'react';
import type { CharacterId, PokemonId } from '../../../game/index.ts';
import { announceSelection } from '../../../app/announce.tsx';
import { SelectGrid, type SelectGridHandle } from '../../components/SelectGrid.tsx';
import { SelectFrame } from '../CrewSelect.tsx';
import {
  CHARACTER_VIEWS, POKEMON_VIEWS, ARCHETYPE, SPECIALTY_LABEL, bestWeak, characterView, pokemonView, rescueSummary, usesLabel,
  type CharacterView, type PokemonView,
} from '../../v3/crewData.ts';
import { CharacterPortrait, MicroBars, PokemonMedallion, RoleProfile, StatBlock, TypeChip } from '../../v3/CrewParts.tsx';

const HINT = 'Arrows browse · Enter continues · or click a card';

// ------------------------------------------------------------------------------------------------- characters

function CharacterCard({ c }: { c: CharacterView }) {
  return (
    <>
      <span className="ccard__art">
        <CharacterPortrait id={c.id} name={c.base.name} size={160} />
        <MicroBars stats={c.action.stats} />
        <span className="ccard__arch">{ARCHETYPE[c.id]}</span>
      </span>
      <span className="ccard__name">{c.base.name}</span>
      <span id={`v3-trait-${c.id}`} className="ccard__trait">{c.action.trait}</span>
    </>
  );
}

function CharacterDetail({ c }: { c: CharacterView }) {
  const bw = bestWeak(c.action.stats);
  return (
    <aside className="v3-detail panel" aria-label={`${c.base.name} details`} data-testid="detail-character">
      <div className="v3-detail__head">
        <CharacterPortrait id={c.id} name={c.base.name} size={160} className="v3-detail__portrait" />
        <div className="v3-detail__names">
          <h2 className="v3-detail__name display">{c.base.name}</h2>
          <span className="arch-chip">{ARCHETYPE[c.id]}</span>
          <p className="v3-detail__ability">{c.action.trait}</p>
          <p className="v3-detail__text">{c.action.traitText}</p>
        </div>
      </div>
      <StatBlock stats={c.action.stats} />
      <p className="v3-detail__bw"><span>Best at: <strong>{bw.best}</strong></span><span>Weak at: <strong>{bw.weak}</strong></span></p>
      <p className="v3-detail__foot">Every crew has 30 points. 5 is average.</p>
    </aside>
  );
}

function Split({ grid, detail }: { grid: ReactNode; detail: ReactNode }) {
  return <div className="v3-split">{grid}{detail}</div>;
}

interface CharacterSelectProps {
  selectedId: CharacterId | null;
  tools: ReactNode;
  onSelect: (id: CharacterId) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function CharacterSelectV3({ selectedId, tools, onSelect, onBack, onContinue }: CharacterSelectProps) {
  const titleId = useId();
  const gridRef = useRef<SelectGridHandle>(null);
  const [focused, setFocused] = useState<CharacterId | null>(null);
  const shown = characterView(focused ?? selectedId ?? CHARACTER_VIEWS[0]!.id);
  const selected = selectedId ? characterView(selectedId) : null;
  return (
    <SelectFrame
      step={2}
      title="Choose your captain"
      titleId={titleId}
      hint={HINT}
      tools={tools}
      className="screen--select-v3"
      selectedText={selected ? `${selected.base.name} · ${selected.action.trait}` : null}
      missingReason="Choose a captain first"
      onBack={onBack}
      onContinue={() => selectedId && onContinue()}
      gridRef={gridRef}
      testId="screen-character"
      grid={
        <Split
          grid={
            <SelectGrid
              ref={gridRef}
              items={CHARACTER_VIEWS}
              columns={4}
              selectedId={selectedId}
              labelledBy={titleId}
              className="v3-grid v3-grid--chars"
              onFocusItem={setFocused}
              onSelect={(id) => {
                onSelect(id);
                const c = characterView(id);
                announceSelection(`${c.base.name}. ${c.action.trait}. ${c.action.traitText}`);
              }}
              onContinue={onContinue}
              renderCard={(c) => <CharacterCard c={c} />}
              describedBy={(c) => `v3-trait-${c.id}`}
              label={(c) => `${c.base.name}, ${ARCHETYPE[c.id]}, ${c.action.trait}`}
              testIdPrefix="character"
            />
          }
          detail={<CharacterDetail c={shown} />}
        />
      }
    />
  );
}

// ------------------------------------------------------------------------------------------------- Pokémon

function PokemonCard({ p }: { p: PokemonView }) {
  return (
    <>
      <PokemonMedallion id={p.id} name={p.base.name} size={96} className="pcard__art" />
      <span className="pcard__name">{p.base.name}</span>
      <span id={`v3-ability-${p.id}`} className="pcard__type"><TypeChip ability={p.ability} compact /></span>
    </>
  );
}

function PokemonDetail({ p }: { p: PokemonView }) {
  const a = p.ability;
  return (
    <aside className="v3-detail panel" aria-label={`${p.base.name} details`} data-testid="detail-pokemon">
      <div className="v3-detail__head">
        <PokemonMedallion id={p.id} name={p.base.name} size={150} className="v3-detail__medallion" />
        <div className="v3-detail__names">
          <h2 className="v3-detail__name display">{p.base.name}</h2>
          <TypeChip ability={a} />
          <p className="v3-detail__ability">{a.abilityName}</p>
          <p className="v3-detail__uses num">{usesLabel(a)}</p>
        </div>
      </div>
      <p className="v3-detail__text v3-detail__desc">{a.description}</p>
      <dl className="v3-detail__facts">
        <div><dt>Rescue</dt><dd>{rescueSummary(a)}</dd></div>
        {a.passive && <div><dt>Passive</dt><dd>{a.passive.text}</dd></div>}
      </dl>
      <RoleProfile id={p.id} />
    </aside>
  );
}

interface PokemonSelectProps {
  characterId: CharacterId;
  selectedId: PokemonId | null;
  tools: ReactNode;
  onSelect: (id: PokemonId) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function PokemonSelectV3({ characterId, selectedId, tools, onSelect, onBack, onContinue }: PokemonSelectProps) {
  const titleId = useId();
  const gridRef = useRef<SelectGridHandle>(null);
  const [focused, setFocused] = useState<PokemonId | null>(null);
  const captain = characterView(characterId);
  const shown = pokemonView(focused ?? selectedId ?? POKEMON_VIEWS[0]!.id);
  const selected = selectedId ? pokemonView(selectedId) : null;
  return (
    <SelectFrame
      step={3}
      title="Choose your ghost Pokémon"
      titleId={titleId}
      hint={HINT}
      chip={
        <span className="chip chip--captain">
          <CharacterPortrait id={captain.id} name="" size={28} className="chip__portrait" />
          Captain: {captain.base.name}
        </span>
      }
      tools={tools}
      className="screen--select-v3"
      selectedText={selected ? `${selected.base.name} · ${selected.ability.abilityName}` : null}
      missingReason="Choose a Pokémon first"
      onBack={onBack}
      onContinue={() => selectedId && onContinue()}
      gridRef={gridRef}
      testId="screen-pokemon"
      grid={
        <Split
          grid={
            <SelectGrid
              ref={gridRef}
              items={POKEMON_VIEWS}
              columns={6}
              selectedId={selectedId}
              labelledBy={titleId}
              className="v3-grid v3-grid--pokemon"
              onFocusItem={setFocused}
              onSelect={(id) => {
                onSelect(id);
                const p = pokemonView(id);
                announceSelection(`${p.base.name}. ${SPECIALTY_LABEL[p.ability.specialty].label}. ${p.ability.abilityName}. ${p.ability.description}`);
              }}
              onContinue={onContinue}
              renderCard={(p) => <PokemonCard p={p} />}
              describedBy={(p) => `v3-ability-${p.id}`}
              label={(p) => `${p.base.name}, ${SPECIALTY_LABEL[p.ability.specialty].label}, ${p.ability.abilityName}`}
              testIdPrefix="pokemon"
            />
          }
          detail={<PokemonDetail p={shown} />}
        />
      }
    />
  );
}
