// v3 crew building blocks (UX_V3_ACTION §5): portraits, absolute 1–10 segmented stat bars, micro-bar fingerprint,
// specialty type chip and role-profile dots. Decorative images carry alt = name; meaning is always also in text.
import type { CharacterStats, PokemonAbilityDef } from '../../action/types.ts';
import type { CharacterId, PokemonId } from '../../game/index.ts';
import { Icon, type IconName } from '../Icon.tsx';
import {
  ROLE_FAMILIES, ROLE_PROFILE, SPECIALTY_LABEL, STAT_KEYS, STAT_LABEL, STAT_MAX, STAT_NEUTRAL,
  characterPortrait, pokemonPortrait, type TypeIcon,
} from './crewData.ts';

const TYPE_ICON: Record<TypeIcon, IconName> = {
  bolt: 'zap', wave: 'wave', heart: 'heart', shield: 'shield', ghost: 'ghost', hand: 'hand', egg: 'egg', eye: 'eye', flame: 'flame', gem: 'gem',
};

export function CharacterPortrait({ id, name, size, className }: { id: CharacterId; name: string; size: number; className?: string }) {
  return (
    <img
      className={`v3-portrait${className ? ` ${className}` : ''}`}
      src={characterPortrait(id)}
      alt={name}
      width={size}
      height={size}
      draggable={false}
      decoding="async"
    />
  );
}

/** Pokémon art has white/pale backgrounds: framed on a moonlit medallion and multiplied into it. */
export function PokemonMedallion({ id, name, size, className }: { id: PokemonId; name: string; size: number; className?: string }) {
  return (
    <span className={`v3-medallion${className ? ` ${className}` : ''}`}>
      <img src={pokemonPortrait(id)} alt={name} width={size} height={size} draggable={false} decoding="async" />
    </span>
  );
}

export function TypeChip({ ability, compact }: { ability: PokemonAbilityDef; compact?: boolean }) {
  const t = SPECIALTY_LABEL[ability.specialty];
  return (
    <span className={`type-chip type-chip--${t.family.toLowerCase()}${compact ? ' type-chip--compact' : ''}`}>
      <Icon name={TYPE_ICON[t.icon]} />
      {t.label}
    </span>
  );
}

/** One stat row: label · 10 fixed segments (absolute scale, neutral tick after 5, hatched deficit) · value + delta. */
export function SegmentedStat({ label, value }: { label: string; value: number }) {
  const delta = value - STAT_NEUTRAL;
  return (
    <div className="seg-stat" role="meter" aria-label={label} aria-valuemin={1} aria-valuemax={STAT_MAX} aria-valuenow={value} aria-valuetext={`${value} of ${STAT_MAX}`}>
      <span className="seg-stat__label">{label}</span>
      <span className="seg-stat__track" aria-hidden="true">
        {Array.from({ length: STAT_MAX }, (_, i) => {
          const n = i + 1;
          const filled = n <= value;
          const deficit = !filled && n <= STAT_NEUTRAL;
          const cls = filled ? (value > STAT_NEUTRAL ? 'is-high' : 'is-low') : deficit ? 'is-deficit' : '';
          return <span key={n} className={`seg${cls ? ` ${cls}` : ''}${n === STAT_NEUTRAL ? ' seg--neutral' : ''}`} />;
        })}
      </span>
      <span className="seg-stat__value num">
        {value}
        <small className={delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}>{delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : '±0'}</small>
      </span>
    </div>
  );
}

export function StatBlock({ stats }: { stats: CharacterStats }) {
  return (
    <div className="seg-stats">
      {STAT_KEYS.map((k) => <SegmentedStat key={k} label={STAT_LABEL[k].full} value={stats[k]} />)}
    </div>
  );
}

/** Five vertical micro-bars: a glanceable "fingerprint" of the stat spread on compact cards. */
export function MicroBars({ stats }: { stats: CharacterStats }) {
  return (
    <span className="micro-bars" aria-hidden="true">
      {STAT_KEYS.map((k) => (
        <span key={k} className={`micro-bar${stats[k] > STAT_NEUTRAL ? ' is-high' : ''}`} title={STAT_LABEL[k].full}>
          <span style={{ height: `${(stats[k] / STAT_MAX) * 100}%` }} />
        </span>
      ))}
    </span>
  );
}

export function RoleProfile({ id }: { id: PokemonId }) {
  const profile = ROLE_PROFILE[id];
  return (
    <dl className="role-profile">
      {ROLE_FAMILIES.map((f, i) => (
        <div key={f}>
          <dt>{f}</dt>
          <dd aria-label={`${profile[i]} of 3`}>
            {[0, 1, 2].map((d) => <span key={d} className={d < profile[i] ? 'is-on' : ''} aria-hidden="true" />)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
