// Seed generation and commitment. Pure Web Crypto (available in Deno, browsers and Node >= 19).

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b];
  return out;
}

/** 128-bit cryptographically random seed as 32 lowercase hex chars. */
export function generateSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** SHA-256(utf8(text)) as 64 lowercase hex chars. Published at creation as the seed commitment. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}
