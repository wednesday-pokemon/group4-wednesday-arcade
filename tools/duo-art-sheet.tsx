// Dev-only consistency sheet for the duo card art window. Open /tools/duo-art-sheet.html
// Query: ?w=376 (box width) ; ?mode=sheet|chars|close&pk=alolan_marowak&ch=bianca ; ?hc=1 ; ?spin=1 ; ?bad=1 (&bad2=1)
import { createRoot } from 'react-dom/client';
import type { CSSProperties } from 'react';
import '../src/ui/styles/tokens.css';
import { DuoCardArt } from '../src/ui/mystery/card/DuoCardArt.tsx';
import { PARTNERS } from '../src/mystery/data/partners.ts';
import type { PokemonId } from '../src/game/types.ts';

const THEME: Record<string, [string, string, string]> = {
  Ghost: ['#2e2250', '#0e0a1e', '#a891e6'], Fire: ['#6a2a12', '#200c08', '#f08a3c'], Water: ['#123a5a', '#08142a', '#4f8fd6'],
  Grass: ['#1f4a2a', '#0a1a10', '#7cc46a'], Ice: ['#1c4552', '#0a1820', '#9fe0f0'], Steel: ['#3a3e48', '#121418', '#c9d3e6'],
  Poison: ['#43204f', '#150a1c', '#c06ad8'], Dark: ['#2a2024', '#0c0a0c', '#a8865c'], Flying: ['#2c3a66', '#0e1330', '#a9b8f0'],
  Dragon: ['#2a2a6e', '#0c0c26', '#6c7cf2'],
};
const CHARS = ['wednesday', 'morticia', 'enid', 'bianca', 'eugene', 'gomez', 'ajax'];
const IDS = Object.keys(PARTNERS) as PokemonId[];
const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 376);
const H = Math.round((W * 248) / 376);
if (q.get('hc') === '1') document.documentElement.classList.add('high-contrast');
const themeOf = (id: PokemonId) => PARTNERS[id].types.find((t) => t !== 'Ghost') ?? 'Ghost';

function Cell({ ch, pk, label }: { ch: string; pk: PokemonId; label?: string }) {
  const [top, bottom, accent] = q.get('spin') === '1' ? THEME.Ghost : THEME[themeOf(pk)];
  const style = { '--type-face-top': top, '--type-face-bottom': bottom, '--type-accent': accent, width: W, height: H } as CSSProperties;
  const bad = q.get('bad') === '1';
  return (
    <figure style={{ margin: 0, color: '#ddd', font: '11px system-ui' }}>
      <div style={style}>
        <DuoCardArt
          characterArt={bad ? '/x/none.webp' : `/art/characters/${ch}.webp`}
          characterName={ch}
          pokemonArt={q.get('bad2') === '1' ? '/x/p.webp' : `/art/pokemon/${pk}.webp`}
          pokemonId={pk}
          pokemonName={PARTNERS[pk].name}
          spinning={q.get('spin') === '1'}
        />
      </div>
      <figcaption>{label ?? `${ch} + ${pk}`}</figcaption>
    </figure>
  );
}

function App() {
  const mode = q.get('mode') ?? 'sheet';
  const pk = (q.get('pk') as PokemonId) ?? 'alolan_marowak';
  let cells;
  if (mode === 'chars') cells = CHARS.map((c) => <Cell key={c} ch={c} pk={pk} />);
  else if (mode === 'close') cells = [<Cell key="a" ch={q.get('ch') ?? 'bianca'} pk={pk} />];
  else cells = IDS.map((id, i) => <Cell key={id} ch={CHARS[i % CHARS.length]} pk={id} label={`${CHARS[i % CHARS.length]} + ${id} [${themeOf(id)}]`} />);
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 10, background: '#111', minHeight: '100vh', boxSizing: 'border-box' }}>{cells}</div>;
}
createRoot(document.getElementById('root')!).render(<App />);
