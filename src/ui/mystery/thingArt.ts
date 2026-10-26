// Thing's portrait for the prologue (narrator portrait, dialogue chip, guide icon). Drop the supplied image into
// src/assets/thing/ (png / jpg / jpeg / webp / avif / svg); it is picked up at build time, preferring a file named
// `thing.*`. Until then every slot falls back to the line-art ThingSigil.
const found = import.meta.glob('../../assets/thing/*.{png,jpg,jpeg,webp,avif,svg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function pickThingArt(files: Record<string, string>): string | null {
  const paths = Object.keys(files).sort();
  const named = paths.find((p) => /\/thing\.[a-z]+$/i.test(p));
  const path = named ?? paths[0];
  return path ? files[path]! : null;
}

export const THING_ART: string | null = pickThingArt(found);
