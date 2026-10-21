# Playtest results — mystery v3.1

Honest log. "Bot" = scripted Playwright driver, not a human. Human playtests (≥ 10, plan §11.6) are still required.

## 2026-10-21 — orchestrator keyboard playtests (real input path)
Method: `output/mystery-keyboard-playtest.mjs` — preview build, headless Chromium on this laptop's Intel UHD (ANGLE D3D11),
Playwright keyboard only (W, ←/→ look, C crouch toggle near the Hyde, Shift when chased, E, Q/F when chased within 9 m,
board radio + Accuse + confirm). Route from the sim's nav grid (`output/mystery-route.ts`).

| Duo | Verdict | Egg | Active time | Score | Catches | Hyde | Notes |
|---|---|---|---|---|---|---|---|
| Enid + Gengar | Case Solved | Rare (3) | 192.6 s | 107.4 | 1 (HP 65) | chase at 129.6 s → Q Shadow Ball, F Wolf Shift → cooldown | 0 console errors |
| Ajax + Gholdengo | Case Solved | Legendary (6) | 201.8 s | 398.2 | 1 | chased once | 0 console errors |

Findings:
- Full loop works through real keys: 3 clues → egg → tower deposit → board accusation → results.
- The driver's slow second leg was the TEST ROUTE's fault (crypt-key target snapped outside the crypt wall); the game
  correctly refused the clue through the wall.
- **BLOCKER: frame rate.** Median 83 ms/frame (12 fps) at 1366×768 normal, 50 ms lowGraphics, 33 ms at 640×360; CPU 86 %
  idle → GPU fill-rate bound (the old rowing scene ran 57 fps with the same method). Sent to the 3d-artist.
- **Camera occlusion** at the egg pickup (wall slab hides the avatar). Sent to the 3d-artist.
- Bot sim balance (game-developer, 140 runs/profile): stealthy median 171 s, careless 149 s; all 126 duos finish.

## 2026-10-21 (later) — after the renderer perf fix
| Duo | Verdict | Egg | Active time | Score | Catches | FPS |
|---|---|---|---|---|---|---|
| Morticia + Aegislash | Case Solved | Legendary (6) | 198.0 s | 402.0 | 1 (King's Shield up → no damage, catch counted) | clean 60 / while polling 61 |
- Frame time re-measured on a quiet machine (`output/mystery-fps2.mjs`): 16.7 ms (vsync cap) at 1366×768 normal, low and
  640×360. The earlier 83 ms was scene cost (GPU floor ~12.8 → ~8 ms after the fix) inflated by concurrent agent browsers.
- Camera visibility audit (3d-artist): 272 set-ups at every interaction point + hiding spot, 0 obstructed.
- Analytics proof (frontend, bot-driven): Enid+Gengar, Morticia+Aegislash, Ajax+Gholdengo, Wednesday+Gengar — V hint with
  "Why:", risk chip "ML estimate", all four results panels filled.
- Still required: ≥ 10 HUMAN playtests on the event laptops (timing toward 5–7 min), two stations simultaneously.
