// Fetches the 18 partner Pokémon's official artwork from PokéAPI (https://pokeapi.co/api/v2/) and caches it as
// public/art/pokemon/<id>.webp (320×320, transparent) + public/art/pokemon/pokeapi-manifest.json (sources).
// Cached at build time so kiosks never depend on the venue network. Exact forms matter (move legality is per form).
// Usage: npm run art:pokeapi   (needs network once; re-run to refresh). Requires Python + Pillow for webp encoding.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'https://pokeapi.co/api/v2';
const OUT = 'public/art/pokemon';

// game id → PokéAPI species + the exact form/variety to use
const PARTNERS = {
  gengar: { species: 'gengar' },
  alolan_marowak: { species: 'marowak', form: 'marowak-alola' },
  misdreavus: { species: 'misdreavus' },
  galarian_corsola: { species: 'corsola', form: 'corsola-galar' },
  sableye: { species: 'sableye' },
  dusknoir: { species: 'dusknoir' },
  drifblim: { species: 'drifblim' },
  froslass: { species: 'froslass' },
  jellicent: { species: 'jellicent' },
  chandelure: { species: 'chandelure' },
  aegislash: { species: 'aegislash', form: 'aegislash-shield' },
  trevenant: { species: 'trevenant' },
  dhelmise: { species: 'dhelmise' },
  decidueye: { species: 'decidueye' }, // the Alolan starter, not decidueye-hisui
  dragapult: { species: 'dragapult' },
  basculegion: { species: 'basculegion' },
  ceruledge: { species: 'ceruledge' },
  gholdengo: { species: 'gholdengo' },
};

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'raven-island-school-arcade' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** The PokéAPI "pokemon" resource name for a species/form (default variety when no form is pinned). */
async function pokemonName({ species, form }) {
  if (form) return form;
  const s = await json(`${API}/pokemon-species/${species}`);
  return s.varieties.find((v) => v.is_default).pokemon.name;
}

mkdirSync(OUT, { recursive: true });
const work = join(tmpdir(), 'raven-pokeapi');
mkdirSync(work, { recursive: true });
const manifest = { source: API, fetchedAt: new Date().toISOString(), note: 'Official artwork via PokéAPI sprites. © Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company — used for a non-commercial school event; clear rights before any public use.', partners: {} };

for (const [id, spec] of Object.entries(PARTNERS)) {
  const name = await pokemonName(spec);
  const p = await json(`${API}/pokemon/${name}`);
  const url = p.sprites.other?.['official-artwork']?.front_default ?? p.sprites.other?.home?.front_default ?? p.sprites.front_default;
  if (!url) throw new Error(`no artwork for ${id} (${name})`);
  const png = Buffer.from(await (await fetch(url)).arrayBuffer());
  const tmp = join(work, `${id}.png`);
  writeFileSync(tmp, png);
  // square 320×320 transparent webp, artwork centred
  execFileSync('python', ['-c', [
    'import sys', 'from PIL import Image',
    'im = Image.open(sys.argv[1]).convert("RGBA")', 'bb = im.getbbox()', 'im = im.crop(bb) if bb else im',
    's = max(im.size)', 'c = Image.new("RGBA", (s, s), (0, 0, 0, 0))', 'c.paste(im, ((s - im.width) // 2, (s - im.height) // 2))',
    'c = c.resize((300, 300), Image.LANCZOS)', 'out = Image.new("RGBA", (320, 320), (0, 0, 0, 0))', 'out.paste(c, (10, 10))',
    'out.save(sys.argv[2], "WEBP", quality=88, method=6)',
  ].join('\n'), tmp, join(OUT, `${id}.webp`)]);
  manifest.partners[id] = { pokeapiName: name, pokeapiId: p.id, artworkUrl: url };
  console.log(`${id.padEnd(17)} ← ${name} (#${p.id})`);
}
writeFileSync(join(OUT, 'pokeapi-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${Object.keys(manifest.partners).length} images + manifest to ${OUT}`);
