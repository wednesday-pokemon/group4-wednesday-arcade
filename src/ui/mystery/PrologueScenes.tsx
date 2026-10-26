// Scenes behind Thing's prologue panels: original inline SVG (no external art besides the chosen duo's portraits).
// Each scene is 1600×900, sliced to cover the viewport; focal content sits in the band the letterbox bars leave free.
// The three suspects are framed identically, in case order, and nothing marks one of them.
import type { PrologueSceneId } from '../../app/mystery/prologue.ts';
import type { DuoCardView } from './duoView.ts';

export interface PrologueSuspect {
  id: string;
  name: string;
  role: string;
}

/** "Archivist (role in this story)" → "Archivist". */
export const suspectRole = (role: string) => role.replace(/\s*\(role in this story\)\s*$/i, '');

const STARS: readonly [number, number, number][] = [
  [90, 80, 1.6], [210, 150, 1.1], [330, 60, 1.4], [470, 130, 1], [610, 70, 1.8], [760, 160, 1.2], [880, 50, 1.1],
  [990, 120, 1.5], [1320, 90, 1.2], [1430, 170, 1.7], [1530, 60, 1.1], [150, 260, 1], [420, 240, 1.3], [700, 280, 1],
  [1480, 300, 1.2], [1260, 260, 1], [560, 330, 0.9], [60, 380, 1.1],
];

/** Which case's story panels 2–3 illustrate (CaseDef.prologue.scene). */
export type PrologueVariant = 'archive' | 'crypt' | 'signal';

export function PrologueScene({ id, card, suspects, variant = 'archive' }: {
  id: PrologueSceneId; card: DuoCardView; suspects: readonly PrologueSuspect[]; variant?: PrologueVariant;
}) {
  return (
    <div className={`pscene pscene--${id}`} data-scene={id} data-variant={variant} aria-hidden="true">
      <svg className="pscene__art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <SceneDefs />
        {id === 'island' && <Island />}
        {id === 'death' && variant === 'archive' && <ResearchRoom />}
        {id === 'egg' && variant === 'archive' && <EmptyPedestal />}
        {id === 'death' && variant === 'crypt' && <FallenGate />}
        {id === 'egg' && variant === 'crypt' && <CryptStairs />}
        {id === 'death' && variant === 'signal' && <Lockdown />}
        {id === 'egg' && variant === 'signal' && <Watchtower />}
        {id === 'suspects' && <Gallery />}
        {id === 'hyde' && <Listening />}
        {id === 'assignment' && <Tower />}
      </svg>
      {id === 'suspects' && (
        <ul className="pscene__suspects" data-testid="prologue-suspects">
          {suspects.map((s) => (
            <li key={s.id} className="suspect-card" data-suspect={s.id}>
              <svg viewBox="0 0 120 120" className="suspect-card__silhouette" focusable="false">
                <circle cx="60" cy="44" r="22" />
                <path d="M18 118c2-30 20-46 42-46s40 16 42 46z" />
                <text x="60" y="54" textAnchor="middle">?</text>
              </svg>
              <span className="suspect-card__name display">{s.name}</span>
              <span className="suspect-card__role">{suspectRole(s.role)}</span>
            </li>
          ))}
        </ul>
      )}
      {id === 'assignment' && (
        <div className="pscene__duo" data-testid="prologue-duo">
          <img src={card.characterArt} alt="" width={160} height={160} />
          <img src={card.pokemonArt} alt="" width={160} height={160} />
        </div>
      )}
    </div>
  );
}

function SceneDefs() {
  return (
    <defs>
      <linearGradient id="ps-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#060914" />
        <stop offset="0.6" stopColor="#161a3a" />
        <stop offset="1" stopColor="#232857" />
      </linearGradient>
      <linearGradient id="ps-lake" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#141a3d" />
        <stop offset="1" stopColor="#05070f" />
      </linearGradient>
      <radialGradient id="ps-moon-glow">
        <stop offset="0" stopColor="#f3ecdc" stopOpacity="0.35" />
        <stop offset="1" stopColor="#f3ecdc" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="ps-lantern-glow">
        <stop offset="0" stopColor="#f5b04c" stopOpacity="0.55" />
        <stop offset="1" stopColor="#f5b04c" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="ps-egg-glow">
        <stop offset="0" stopColor="#4fd8e8" stopOpacity="0.5" />
        <stop offset="1" stopColor="#4fd8e8" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="ps-eye-glow">
        <stop offset="0" stopColor="#ff7b7b" stopOpacity="0.9" />
        <stop offset="1" stopColor="#ff7b7b" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="ps-beam" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#d9d4f2" stopOpacity="0.28" />
        <stop offset="1" stopColor="#d9d4f2" stopOpacity="0" />
      </linearGradient>
      <filter id="ps-blur"><feGaussianBlur stdDeviation="18" /></filter>
    </defs>
  );
}

function Stars() {
  return (
    <g className="pscene__stars" fill="#f3ecdc">
      {STARS.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} style={{ animationDelay: `${(i % 6) * 0.45}s` }} />)}
    </g>
  );
}

function Moon({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r * 3.4} fill="url(#ps-moon-glow)" />
      <circle cx={x} cy={y} r={r} fill="#f3ecdc" />
      <circle cx={x - r * 0.3} cy={y - r * 0.2} r={r * 0.16} fill="#d4cbb5" opacity="0.6" />
      <circle cx={x + r * 0.28} cy={y + r * 0.3} r={r * 0.1} fill="#d4cbb5" opacity="0.5" />
    </g>
  );
}

/** Panel 1: moonlit castle across the dark lake. */
function Island() {
  return (
    <g>
      <rect width="1600" height="900" fill="url(#ps-sky)" />
      <Stars />
      <Moon x={1160} y={200} r={74} />
      {/* island + castle silhouette */}
      <g fill="#05070f">
        <path d="M420 600c60-40 140-70 240-82 60-60 120-80 160-80s110 30 160 84c110 12 190 40 240 78z" />
        <rect x="700" y="380" width="56" height="150" />
        <path d="M694 384l34-70 34 70z" />
        <rect x="770" y="420" width="140" height="110" />
        <path d="M770 420h140l-20-26h-100z" />
        <rect x="920" y="330" width="60" height="200" />
        <path d="M914 334l36-92 36 92z" />
        <rect x="990" y="440" width="44" height="90" />
        <path d="M986 444l26-50 26 50z" />
        <rect x="640" y="460" width="50" height="70" />
      </g>
      <g className="pscene__windows" fill="#f5b04c">
        <rect x="722" y="410" width="10" height="16" rx="5" />
        <rect x="942" y="370" width="12" height="20" rx="6" />
        <rect x="830" y="452" width="9" height="14" rx="4" />
      </g>
      <rect y="596" width="1600" height="304" fill="url(#ps-lake)" />
      <g className="pscene__shimmer" fill="#f3ecdc">
        <rect x="1110" y="630" width="100" height="3" rx="1.5" opacity="0.5" />
        <rect x="1090" y="668" width="140" height="3" rx="1.5" opacity="0.35" />
        <rect x="1125" y="706" width="70" height="3" rx="1.5" opacity="0.4" />
        <rect x="1070" y="748" width="180" height="3" rx="1.5" opacity="0.25" />
      </g>
      <ellipse className="pscene__mist" cx="800" cy="600" rx="900" ry="46" fill="#b8b3cc" opacity="0.16" filter="url(#ps-blur)" />
    </g>
  );
}

/** Panel 2: the sealed research chamber — scattered papers, a toppled chair, the seal on the door. */
function ResearchRoom() {
  return (
    <g>
      <rect width="1600" height="900" fill="#0d1124" />
      {/* arched window + moonbeam */}
      <path d="M260 150h220v300H260z M260 150a110 110 0 0 1 220 0" fill="#1b2150" />
      <path d="M370 40a110 110 0 0 1 110 110v300H260V150A110 110 0 0 1 370 40z" fill="#232857" stroke="#05070f" strokeWidth="14" />
      <path d="M370 40v410M260 250h220" stroke="#05070f" strokeWidth="10" />
      <polygon points="260,450 480,450 1000,900 560,900" fill="url(#ps-beam)" />
      {/* door with the seal */}
      <rect x="1060" y="130" width="300" height="520" fill="#161a3a" stroke="#05070f" strokeWidth="14" />
      <path d="M1210 130v520" stroke="#05070f" strokeWidth="8" />
      <path d="M1040 230l340 300M1380 230L1040 530" stroke="#d4cbb5" strokeWidth="16" opacity="0.55" />
      <g className="pscene__seal">
        <circle cx="1210" cy="380" r="58" fill="#7a1f2b" />
        <circle cx="1210" cy="380" r="44" fill="none" stroke="#c0485a" strokeWidth="4" />
        <path d="M1188 398c6-26 20-40 38-42-6 8-6 14 0 18-10 2-16 10-18 24z" fill="#f3ecdc" opacity="0.75" />
      </g>
      {/* desk, lantern, toppled chair, papers */}
      <rect x="520" y="560" width="440" height="26" fill="#05070f" />
      <rect x="540" y="586" width="20" height="160" fill="#05070f" />
      <rect x="920" y="586" width="20" height="160" fill="#05070f" />
      <circle cx="880" cy="520" r="140" fill="url(#ps-lantern-glow)" className="pscene__flicker" />
      <path d="M864 556h32l-6-46h-20z" fill="#f5b04c" />
      <path d="M700 548h46l-6 14h-34z" fill="#d4cbb5" />
      <path d="M746 551c12 0 12 9 0 9" fill="none" stroke="#d4cbb5" strokeWidth="4" />
      <ellipse cx="723" cy="548" rx="20" ry="4" fill="#8b5cf6" opacity="0.8" />
      <path d="M860 510h40M880 498v12" stroke="#05070f" strokeWidth="6" />
      <g fill="#05070f" transform="rotate(-62 360 720)">
        <rect x="300" y="700" width="120" height="16" />
        <rect x="300" y="610" width="16" height="106" />
        <rect x="404" y="716" width="14" height="70" />
      </g>
      <g fill="#d4cbb5">
        <rect x="610" y="770" width="80" height="56" transform="rotate(-14 650 798)" opacity="0.7" />
        <rect x="720" y="800" width="70" height="50" transform="rotate(22 755 825)" opacity="0.55" />
        <rect x="580" y="540" width="90" height="16" opacity="0.6" />
      </g>
    </g>
  );
}

/** Panel 3: the empty pedestal and the ghost of the egg that should be on it. */
function EmptyPedestal() {
  return (
    <g>
      <rect width="1600" height="900" fill="#090d1d" />
      <polygon points="700,0 900,0 1060,900 540,900" fill="url(#ps-beam)" opacity="0.7" />
      <circle cx="800" cy="350" r="230" fill="url(#ps-egg-glow)" className="pscene__pulse" />
      <path
        className="pscene__ghost-egg"
        d="M800 200c-60 0-108 96-108 162 0 60 48 96 108 96s108-36 108-96c0-66-48-162-108-162z"
        fill="none" stroke="#4fd8e8" strokeWidth="5" strokeDasharray="14 12"
      />
      <path d="M690 480c20 24 60 36 110 36s90-12 110-36" fill="none" stroke="#6b6aa8" strokeWidth="10" strokeLinecap="round" />
      <path d="M660 490h280l-30 40H690z" fill="#232857" />
      <rect x="730" y="530" width="140" height="230" fill="#161a3a" />
      <path d="M690 760h220l30 60H660z" fill="#232857" />
      <g className="pscene__sparkles" fill="#4fd8e8">
        {[[640, 260], [960, 230], [700, 420], [930, 400], [800, 150]].map(([x, y], i) => (
          <path key={i} d={`M${x} ${y - 12}l3 9 9 3-9 3-3 9-3-9-9-3 9-3z`} style={{ animationDelay: `${i * 0.5}s` }} />
        ))}
      </g>
    </g>
  );
}

/** Panel 4: a dim gallery behind the three (HTML) suspect cards. */
function Gallery() {
  return (
    <g>
      <rect width="1600" height="900" fill="#0b1020" />
      {[200, 800, 1400].map((x) => (
        <g key={x}>
          <circle cx={x} cy="190" r="120" fill="url(#ps-lantern-glow)" className="pscene__flicker" opacity="0.6" />
          <rect x={x - 5} y="200" width="10" height="40" fill="#efe6cc" />
          <path d={`M${x} 180c-6 8-6 14 0 20 6-6 6-12 0-20z`} fill="#f5b04c" />
        </g>
      ))}
      <path d="M0 0h140c-20 300 0 600 40 900H0z M1600 0h-140c20 300 0 600-40 900h180z" fill="#3a1424" opacity="0.8" />
    </g>
  );
}

/** Panel 5: eyes in the dark and the ripples of a careless step. */
function Listening() {
  return (
    <g>
      <rect width="1600" height="900" fill="#04060d" />
      <g fill="#0b1020">
        {[80, 260, 430, 1140, 1320, 1500].map((x, i) => <rect key={x} x={x} y="0" width={50 + (i % 3) * 18} height="900" />)}
      </g>
      <ellipse className="pscene__mist" cx="800" cy="560" rx="760" ry="80" fill="#2e3366" opacity="0.4" filter="url(#ps-blur)" />
      <g className="pscene__eyes">
        <circle cx="800" cy="330" r="120" fill="url(#ps-eye-glow)" opacity="0.35" />
        <ellipse cx="766" cy="330" rx="20" ry="9" fill="#ff7b7b" />
        <ellipse cx="834" cy="330" rx="20" ry="9" fill="#ff7b7b" />
      </g>
      <g className="pscene__ripples" fill="none" stroke="#d4cbb5">
        {[0, 1, 2].map((i) => <ellipse key={i} cx="800" cy="640" rx="60" ry="16" style={{ animationDelay: `${i * 0.6}s` }} />)}
      </g>
    </g>
  );
}

/** Panel 6 / mission card: Iago Tower on the hill, its window lit. */
function Tower() {
  return (
    <g>
      <rect width="1600" height="900" fill="url(#ps-sky)" />
      <Stars />
      <Moon x={360} y={170} r={56} />
      <path d="M0 640c260-60 520-120 820-140 280-20 560 40 780 110v290H0z" fill="#0b1020" />
      <path d="M560 900c80-140 240-260 420-330" fill="none" stroke="#2e3366" strokeWidth="18" strokeDasharray="2 26" strokeLinecap="round" />
      <g fill="#05070f">
        <rect x="1000" y="250" width="110" height="330" />
        <path d="M986 256l69-130 69 130z" />
        <rect x="990" y="250" width="130" height="18" />
        <path d="M980 590h150l-25-24h-100z" />
      </g>
      <circle cx="1055" cy="300" r="110" fill="url(#ps-lantern-glow)" className="pscene__flicker" />
      <rect x="1043" y="282" width="24" height="38" rx="12" fill="#f5b04c" />
    </g>
  );
}

/** Case 02 panel 2: the crypt arch and its fallen gate, chain snapped. */
function FallenGate() {
  return (
    <g>
      <rect width="1600" height="900" fill="#070a16" />
      <path d="M520 640V300a280 280 0 0 1 560 0v340z" fill="#161a3a" stroke="#05070f" strokeWidth="26" />
      <path d="M560 640V310a240 240 0 0 1 480 0v330z" fill="#04060d" />
      <ellipse className="pscene__mist" cx="800" cy="620" rx="420" ry="40" fill="#6fd6a0" opacity="0.12" filter="url(#ps-blur)" />
      <g transform="rotate(8 800 600)" stroke="#2e3366" strokeWidth="12">
        {[600, 660, 720, 780, 840, 900, 960].map((x) => <path key={x} d={`M${x} 420v200`} />)}
        <path d="M580 440h420M580 520h420M580 600h420" />
      </g>
      <path d="M800 70v190" stroke="#6b6aa8" strokeWidth="6" strokeDasharray="14 8" />
      <path d="M790 262l20 26M812 262l-18 30" stroke="#a49fbf" strokeWidth="6" />
      <g className="pscene__sparkles" fill="#d4cbb5">
        {[[700, 650], [880, 660], [760, 690], [940, 640]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" style={{ animationDelay: `${i * 0.4}s` }} />)}
      </g>
      <circle cx="1150" cy="300" r="120" fill="url(#ps-lantern-glow)" className="pscene__flicker" opacity="0.5" />
    </g>
  );
}

/** Case 02 panel 3: stairs down into the burial vault, where the egg's glow went. */
function CryptStairs() {
  return (
    <g>
      <rect width="1600" height="900" fill="#05070f" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={560 + i * 28} y={300 + i * 52} width={480 - i * 56} height="40" fill={i % 2 ? '#161a3a' : '#1b2150'} />
      ))}
      <circle cx="800" cy="660" r="200" fill="url(#ps-egg-glow)" className="pscene__pulse" />
      <path
        className="pscene__ghost-egg" d="M800 560c-34 0-60 54-60 92 0 34 26 54 60 54s60-20 60-54c0-38-26-92-60-92z"
        fill="none" stroke="#4fd8e8" strokeWidth="4" strokeDasharray="10 9"
      />
      <path d="M520 0v900M1080 0v900" stroke="#0b1020" strokeWidth="120" />
    </g>
  );
}

/** Case 03 panel 2: the security console, alarms dark, LOCKDOWN on every screen. */
function Lockdown() {
  return (
    <g>
      <rect width="1600" height="900" fill="#090c1a" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${430 + i * 260} 200)`}>
          <rect width="220" height="150" rx="10" fill="#161a3a" stroke="#05070f" strokeWidth="10" />
          <rect x="16" y="16" width="188" height="118" rx="4" fill="#3a1424" className="pscene__flicker" />
          <text x="110" y="84" textAnchor="middle" fill="#ff7b7b" fontSize="26" fontFamily="var(--font-display)">LOCKDOWN</text>
        </g>
      ))}
      <path d="M380 470h840l60 120H320z" fill="#161a3a" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <circle key={i} cx={460 + i * 96} cy="530" r="14" fill={i === 3 ? '#f5b04c' : '#2e3366'} />)}
      <g className="pscene__eyes"><circle cx="1260" cy="160" r="40" fill="#ff7b7b" opacity="0.25" /></g>
    </g>
  );
}

/** Case 03 panel 3: the watchtower beam sweeping a dark yard; the egg path below is empty. */
function Watchtower() {
  return (
    <g>
      <rect width="1600" height="900" fill="url(#ps-sky)" />
      <Stars />
      <path d="M0 660c300-50 700-80 1600-40v280H0z" fill="#0b1020" />
      <g fill="#05070f">
        <rect x="380" y="240" width="90" height="420" />
        <path d="M364 250l61-110 61 110z" />
      </g>
      <polygon className="pscene__beam" points="430,250 1400,520 1400,640" fill="#f5b04c" opacity="0.18" />
      <circle cx="430" cy="252" r="16" fill="#f5b04c" />
      <path d="M900 900c40-120 160-200 300-250" fill="none" stroke="#2e3366" strokeWidth="16" strokeDasharray="2 24" strokeLinecap="round" />
    </g>
  );
}
