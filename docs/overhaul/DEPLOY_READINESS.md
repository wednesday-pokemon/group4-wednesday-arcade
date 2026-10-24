# Deploy readiness — Nevermore: Deadly Secrets overhaul (event Tue Oct 27, 2026)

Owner: deployment-engineer · Measured 2026-10-24 on the dev laptop (i7-11800H, Intel UHD + RTX 3050, Windows 11,
Chrome 155) against snapshots of two production builds of the (uncommitted) working tree: **build 1** (`dist/`
fingerprint `184d0b7076141211`, 2026-10-23 23:56) and **build 2** (`79233e68105f5f65`, after the code-review fixes to
`useMysteryLoop.ts` / `run.ts`), each served with `npx vite preview --port 4174 --strictPort` (preview stopped
afterwards; the 5173 dev server was not touched). Fingerprint = `cd dist && find . -type f | sort | xargs sha256sum |
sha256sum`. Nothing was deployed and the hosted Supabase project was never contacted:
every browser check ran with all non-localhost traffic blocked (Chromium `--host-resolver-rules` + a Playwright route
abort), and `check-laptop.ps1` ran with `-SkipSupabase`. Operator procedure: [`../OPERATOR_RUNBOOK.md`](../OPERATOR_RUNBOOK.md);
laptop setup: [`../THREE_LAPTOP_RUNBOOK.md`](../THREE_LAPTOP_RUNBOOK.md).

## Verdict

| Plan | Verdict | Why |
|---|---|---|
| **Plan D — LOCAL DEMO** (no network) | **GO, conditional** on the owner items marked ☐ in §7 (freeze commit, event-laptop perf check, laptop settings, rehearsal on the real laptops). | Build green, offline end-to-end, two concurrent stations independent, every case reachable through the real journey. |
| **Plan L — live / verified** | **NO-GO today.** It becomes GO only after the owner runs the §3 deploy (OPERATOR_RUNBOOK) and a live two-station rehearsal passes. | Mystery backend (6 migrations, 6 functions) not deployed; the live station/board path has only run against the fake project, never the hosted one. |

## 1. Production build

| Check | Command | Result |
|---|---|---|
| Build | `npm run build` (sync:shared → `tsc --noEmit` → `vite build`) | **PASS** twice — build 1 and build 2 each exit 0 in 32 s (vite ≈ 9–10 s, 408 modules), **0 warnings** (chunk limit 900 kB; largest chunk 606 kB). Logs: `output/overhaul/deploy/build.clean.log`, `build2.clean.log`. |
| sync:shared | (part of build) | Synced 12 rule files + 16 mystery files into `supabase/functions/_shared/**`, registry regenerated. These files are part of the uncommitted overhaul tree — commit them with the freeze commit. |
| Key leak | `node scripts/kiosk/check-dist-keys.mjs` | **PASS** (build 1 and build 2) — "No privileged keys found." Only the anon JWT for ref `abkohhdjlufhsbqrchpn` (browser-safe) in 3 chunks + `.env`. |
| Freeze commit | `git status --short` / `git rev-parse --short HEAD` | **NOT READY** — HEAD `2842ec1` with **173 uncommitted paths** (the whole overhaul; agents still editing). The event build must be rebuilt from a committed tree and §2/§3 re-run on it (≈ 3 min, §11). |

Bundle (`dist/`, 164 files, **23 MB**): JS 2.16 MB raw in 28 chunks (largest: `actors` 606 kB / 158 kB gzip = three.js,
`index` 485 kB / 157 kB gzip, `MysteryScene` 275 kB / 90 kB gzip, `StageView` 165 kB, `index` 124 kB, `client` 106 kB =
supabase-js, loaded only by live routes), CSS 189 kB, fonts 588 kB (woff/woff2, @fontsource Cinzel + Alegreya Sans),
`assets/thing-*.png` 435 kB; `models/` 13 MB (17 Pokémon GLBs + manifest), `art/` 5.5 MB, `audio/` 1.3 MB, `draco/`
248 kB (decoder WASM + wrapper, loaded from `/draco/`).

**Runtime assets are all local.** External hosts referenced in the bundle: `pokemondb.net` / `serebii.net` (move
source links shown as text), `w3.org` (XML namespaces), `reactjs.org` / `developer.mozilla.org` (error-message text),
`localhost:9999` (supabase-js default, unused), `abkohhdjlufhsbqrchpn.supabase.co` (live routes only), and
`pokemon-3d-api.onrender.com` — the optional community model catalog, requested only for a Pokémon missing from the local
cache: **Galarian Corsola** (no working upstream model, DECISIONS D-37). Offline it falls back to its artwork billboard
(verified §2, flow C); online it makes one catalog request and still ends on the artwork.

## 2. Offline check (Plan D) — `output/deploy-offline.mjs`

`BASE=http://localhost:4174 node output/deploy-offline.mjs` → `output/overhaul/deploy/offline-report.json` + screenshots
`A*`, `B*`, `C*`, `D*` in `output/overhaul/deploy/` (build 2; build 1 copies in `run1/`). 1366×768, Chromium
`--use-angle=d3d11 --ignore-gpu-blocklist`. Both builds gave the same results; numbers below are build 1, build 2 in
brackets where different.

| Flow | What | Result | Blocked internet attempts | Console / page errors |
|---|---|---|---|---|
| A | `/` Home → nickname → duo cards → case reveal → prologue skip → tutorial (first 20 s, real time) → play | **PASS** — Home 0.75 s; case reveal 4.2 s (`poisoned_archive` [`midnight_signal`]); island ready 1.3 s [0.1 s] after Skip; tutorial steps intro → walk → silent → search at 1/7/13/20 s; companion = local GLB | 0 | 0 / 0 |
| B | `/?mode=mystery&character=enid&pokemon=gengar&seed=dep1&case=midnight_signal&tutorial=0` + `mysteryAutopilot('stealthy')` + `advanceTime(5000)` loops | **PASS** — accusation screen at t = 151.7 s, 3/3 clues; accused → results "case_solved", score −51.7, `backend: local_demo` | 0 | 0 / 0 |
| C | `bianca + galarian_corsola`, Case 01 | **PASS** — companion `visual: art` ("local: not listed; community: Failed to fetch"), run continues | 1 (`pokemon-3d-api.onrender.com`, expected) | 1 "Failed to load resource" (that request) / 0 |
| D1 | `/?mode=dashboard` (live board) | **PASS (degrades correctly)** — header "OFFLINE", banner "Live data could not be refreshed (TypeError: Failed to fetch)… retrying", station cards Idle | 3 REST + Realtime WebSocket to the project host, all blocked before leaving the machine | 10 [12] network errors (those requests) / 0 |
| D2 | `/?mode=dashboard&demo=1` (Plan D board) | **PASS** — KPI ribbon, station card, standings, 4 analytics panels render with 0 runs | 0 | 0 / 0 |
| D3 | `/?mode=terminal&station=station_a` (live station) | **PASS** — sign-in gate with "Retry live" and "Play LOCAL DEMO (unverified)" | 0 | 0 / 0 |

## 3. Two-station rehearsal (Plan D) — `output/deploy-two-station.mjs`

`BASE=http://localhost:4174 VISITORS=3 node output/deploy-two-station.mjs` → `two-station-report.json`, screenshots `R-*`.
Station A and station B = two isolated browser contexts (separate storage, like two laptops) playing **at the same
time**, 3 visitors each through the real journey (A picks card 1, B picks card 3); Laptop 1 = a third context on
`/?mode=dashboard&demo=1`, polled every 8 s. Internet blocked. Wall time 56–64 s. Run three times: build 1, build 2
(where B's 3rd visitor drew Galarian Corsola — its expected, blocked catalog request tripped an over-strict check, now an
explicit allowance; report kept in `run1/two-station-report-run2a-corsola.json`), build 2 again (shown second below).

| Station | Visitor | Case (dealt at Home = reveal = result) | Duo | Result |
|---|---|---|---|---|
| A | StA-1 / StA-2 / StA-3 | midnight_signal → poisoned_archive → crypt_last_witness | gomez+alolan_marowak · ajax+aegislash · eugene+aegislash | case_solved 109.6 s · 158.1 s · 134.7 s |
| B | StB-1 / StB-2 / StB-3 | crypt_last_witness → midnight_signal → poisoned_archive | wednesday+decidueye · wednesday+basculegion · ajax+drifblim | case_solved 141.0 s · 132.8 s · 139.6 s |
| A (build 2) | StA-1 / StA-2 / StA-3 | midnight_signal → poisoned_archive → crypt_last_witness | bianca+sableye · eugene+decidueye · eugene+decidueye | case_solved 119.8 s · 149.3 s · 227.7 s |
| B (build 2) | StB-1 / StB-2 / StB-3 | poisoned_archive → midnight_signal → crypt_last_witness | ajax+misdreavus · enid+dragapult · eugene+chandelure | case_solved 150.6 s · 118.7 s · 117.4 s |

18/18 checks PASS in each run: per station the case bag dealt all three cases in three visitors, never the same case twice in a row;
case at Home = case-file reveal = result case; fresh seed per visitor; every result `local_demo`; each station's
`raven.mystery.records` holds exactly its own 3 nicknames; no seed or session id shared between stations; no internet
request; 0 console / page errors.

**What the Plan D board shows:** in its own context **0 runs** for the whole rehearsal ("Idle · No visitor yet", Station
B card: "Both stations appear here live once the Supabase backend is deployed…"). The same board opened inside station
A's profile showed exactly station A's 3 runs (KPI: 3 runs, 100 % solved, median 2:14; standings StA-1/2/3). LOCAL
DEMO data lives in each browser's `localStorage` and never crosses laptops — Laptop 1 cannot show stations 2/3 in Plan D
(options: OPERATOR_RUNBOOK §4.1a).

## 4. Performance proxy — `output/deploy-perf.mjs`

Method: production build, 1366×768, headless Chromium (ANGLE D3D11 on **Intel UHD Graphics 0x9A60** — confirmed via
`WEBGL_debug_renderer_info`), one fresh context per run, internet blocked. Low graphics = the kiosk setting
`lowGraphics: true`. CPU slowdown = CDP `Emulation.setCPUThrottlingRate` (1× = this i7-11800H; 2× ≈ a mid-range U-series
school laptop; 4× ≈ a low-end Celeron/Pentium-class CPU). rAF intervals sampled for 8 s in two windows: **W1** = first
seconds of play (Hyde dormant), **W2** = after `advanceTime(22000)` (Hyde out, AI active). Drivers: **bot** =
`mysteryAutopilot('stealthy')` explores the map (its planning is ~1 % of CPU — profile below); **keys** = held W +
periodic turns (no bot). Values are milliseconds per frame, `p50 / p95`; they snap to 60 Hz vsync multiples (16.7, 33.3,
50, 66.7…). Raw: `perf-bot-run1.log`, `perf-run2.log`, `perf-report-*.json`.

| CPU | Graphics | Poisoned Archive W1 · W2 | Crypt's Last Witness W1 · W2 | Midnight Signal W1 · W2 |
|---|---|---|---|---|
| 1× bot | normal | 16.7/16.8 · 16.7/16.7 | 16.7/16.8 · 16.7/16.7 | 16.7/16.8 · 16.7/16.8 |
| 1× bot | low | 16.7/16.8 · 16.7/16.8 | 16.7/16.7 · 16.7/16.8 | 16.7/16.8 · 16.7/16.8 |
| 2× bot | normal | 16.7/16.8 · 16.7/33.3 | 16.7/33.3 · 16.7/33.4 | 16.7/33.3 · 16.7/33.4 |
| 2× bot | low | 16.7/16.7 · 16.7/33.3 | 16.7/16.8 · 16.7/33.4 | 16.7/33.3 · 16.7/16.8 |
| 2× keys | normal | 16.7/16.8 · 16.7/33.3 | 16.7/16.8 · 16.7/33.4 | 16.7/16.8 · 16.7/33.4 |
| 2× keys | low | 16.7/50.0 · 16.7/33.4 | 16.7/33.4 · 16.8/50.1 | 16.7/33.3 · 16.7/33.4 |
| 4× bot | normal | 33.4/66.5 · 33.4/100.1 | 49.9/83.3 · 66.6/100.0 | 50.0/83.3 · 50.0/133.4 |
| 4× bot | low | 50.0/166.7 · 83.3/233.3 | 33.4/83.4 · 50.0/100.0 | 50.0/100.0 · 50.0/283.3 |
| 4× keys | normal | 50.0/83.3 · 49.9/66.7 | 50.0/83.3 · 50.0/83.3 | 50.1/116.7 · 50.0/83.3 |
| 4× keys | low | 33.4/50.1 · 50.0/66.7 | 49.9/66.7 · 50.0/66.7 | 33.4/66.6 · 33.4/66.6 |

Build 2 re-check (1×, bot, all cases, normal + low): p50 16.7 ms, p95 ≤ 16.8 ms in W1 and W2, 58–60 fps
(`perf-report-bot-build2-1x.json`). Average fps: 1× 57–60 everywhere; 2× 47–60 (bot) / 37–57 (keys); 4× 10–26. Scene cost: 36–64 draw calls, 93–107 k
triangles normal, 67–82 k low. 0 page errors in all 30 runs.

**Reading it.** On this laptop the game holds the 60 fps cap in every case, both modes. At 2× slower CPU the median stays
at 60 fps with occasional 33–50 ms frames (fine for a stealth game). At 4× the median drops to 20–30 fps with 67–283 ms
spikes. **Low graphics does not rescue a slow CPU** (it removes ~25 % of triangles, a GPU saving; the 4× rows are within
noise of normal). Caveat: the machine was 71–83 % busy with other agents' dev servers and browsers during every run, and
CDP throttling stacks on top of that load — so the 2×/4× rows are pessimistic. One 4× trace on the same build reached
42 fps (`trace-4x-midnight_signal.json`).

**Where the frame goes** (`output/deploy-profile.mjs`, 4×, Hyde out, Case 03; `deploy-trace.mjs`): main-thread script in
`requestAnimationFrame` ≈ 16 ms/frame at 4× (≈ 4 ms at 1×); style + layout + paint ≈ 3 ms/frame at 4× (the DOM HUD is
cheap); GC negligible. Self time: native/unattributed 42–44 %, three.js renderer 17–20 %, game loop + HUD
(`useMysteryLoop`, `PlayView`) 9 %, canvas-2D compass/minimap text and paths ≈ 5 % (`measureText` alone 2.1–2.3 %), sim
(`run`, `player`) 2–3 %, bot ≈ 1 %. Shader programs settle at 28 after the Hyde emerges (no continuous recompiles). One
avoidable cost found: 4–5 transparent `DoubleSide` materials are drawn twice and re-validated every frame (§10 P1).

## 5. Kiosk tooling

| Check | Command | Result |
|---|---|---|
| Laptop checker (read-only) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk\check-laptop.ps1 -BaseUrl http://localhost:4174 -SkipSupabase` | Runs; dev laptop: **3 FAIL** (Sticky Keys shortcut, Filter Keys shortcut, sleep after 10 min) + WARN 144 Hz, two GPUs, mouse acceleration, notifications, updates not paused, screen off 5 min. Game URL PASS; Supabase SKIP. Log `check-laptop.log`. New this pass: `-SkipSupabase`, refresh-rate WARN > 60 Hz, two-GPU WARN, kiosk-profile zoom check (tested with fake profiles: zoomed → WARN, 100 % → PASS). |
| Launcher dry runs | `launch-kiosk.ps1 -Role station_a\|station_b\|dashboard [-Live] -DryRun` | **PASS** — Plan D `/`, `/?mode=dashboard&demo=1`; Plan L `/?mode=terminal&station=station_b`, `/?mode=dashboard`; LAN base adds `--unsafely-treat-insecure-origin-as-secure` (log `launcher-dryrun.log`). `-Live` station route verified against `src/app/routing.ts` (mystery kiosk). |

## 6. Automated tests

| Suite | Command | Result |
|---|---|---|
| Typecheck (app + functions), vitest, supabase unit | `npm run test:all` | **PASS** — exit 0 in 159 s: `tsc` app ✔, `tsc` functions ✔, vitest **76 files / 1672 tests**, supabase unit **6 files / 88 tests** (log `test-all.log`; working tree incl. the code-review fixes, same tree as build 2). |
| pgTAP on PGlite (all 10 migrations: 4 v2.5 + the 6 mystery ones) | `npm run test:db:offline` | **PASS** — every migration applied (`…000500` → `20261023000100_mystery_overhaul`), suites 001–007: 32 + 55 + 65 + 109 + 64 + 24 + 40 = **389 / 389** assertions (log `test-db-offline.log`). |
| Not run by me | `npm run test:db:roundtrip`, `npx vitest run tests/integration` (included in vitest above), `tests/e2e/*.mjs` | Owner runs `test:db:roundtrip` in OPERATOR_RUNBOOK §3 step 4. |

## 7. GO / NO-GO checklist

`✔` = verified with evidence (this doc). `✘` = failing / not done. `☐` = owner action pending. Nothing pending is claimed done.

**Software (dev laptop)**

| # | Item | Status | Evidence |
|---|---|---|---|
| S1 | Production build green, no warnings | ✔ | §1 |
| S2 | No privileged key in `dist/` / `.env` | ✔ | §1 `check-dist-keys.mjs` |
| S3 | No runtime internet dependency in Plan D (fonts, Draco, art, models, audio local) | ✔ | §1 scan + §2 (0 blocked requests on flows A/B/D2/D3) |
| S4 | Full journey offline: Home → cards → case reveal → prologue → tutorial → play → accusation → results | ✔ | §2 A + B |
| S5 | All three cases reachable through the real journey, case bag per station | ✔ | §3 |
| S6 | Two stations concurrently, no cross-station leakage | ✔ (Plan D) | §3 |
| S7 | Live routes degrade safely offline (board OFFLINE banner, station gate offers LOCAL DEMO) | ✔ | §2 D1/D3 |
| S8 | 60 fps cap at 1366×768 on this laptop (Intel UHD), normal + low, every case | ✔ | §4 (1×) |
| S9a | Playable on a 2× slower CPU (median 60 fps, p95 ≤ 50 ms) | ✔ (proxy) | §4 (2× rows) |
| S9b | Smooth on a 4× slower CPU | ✘ (p50 33–83 ms) | §4 — see risk R3 |
| S10 | Automated tests green (`test:all`, `test:db:offline`) | ✔ | §6 |
| S11 | **Freeze commit**: overhaul committed, rebuilt from a clean tree, commit id recorded: ______ | ☐ ✘ | §1 (173 uncommitted paths) |

**Backend / live mode (Plan L only)**

| # | Item | Status |
|---|---|---|
| L1 | Owner approval recorded (OPERATOR_RUNBOOK §3 step 1) | ☐ |
| L2 | `db push --dry-run` lists exactly the 6 mystery migrations; pushed; constraints verified (§3 steps 5–7) | ☐ |
| L3 | All 6 functions deployed in one command, no session open across the switch (§3 steps 8–9) | ☐ |
| L4 | Frontend rebuilt from the same commit, redistributed, all three laptops hard-reloaded (§3 step 10) | ☐ |
| L5 | Live rehearsal: both stations + Laptop 1 live, own case per station, Reset station, verified results (§3 step 11) | ☐ |
| L6 | Rehearsal rows deleted (§3 step 12) | ☐ |
| L7 | Venue network: HTTPS **and** Realtime WebSocket OK; hotspot fallback tested | ☐ |

**Event laptops**

| # | Item | Status |
|---|---|---|
| E1 | `check-laptop.ps1` 0 FAIL on Laptops 1/2/3; browser versions: L1 ______ L2 ______ L3 ______ | ☐ |
| E2 | 60 Hz, scale 100 %, browser on the High-performance GPU, zoom 100 % | ☐ |
| E3 | Shift ×5, hold right Shift 9 s, Ctrl+W on both stations — no dialog, tab stays | ☐ |
| E4 | **Real frame rate on Laptops 2 and 3** in all three cases (normal; low if needed) — record fps impression; anything < ~30 fps → see R3 | ☐ |
| E5 | Two stations simultaneously on the real laptops (+ Laptop 1) | ☐ |
| E6 | ≥ 10 human playtests across duos; record door-to-door times (target 5–7 min) | ☐ |
| E7 | 30-minute idle soak: no sleep, dimming, pop-ups | ☐ |
| E8 | USB stick: repo at the freeze commit incl. `dist/` + `node_modules/` + Node LTS installer | ☐ |
| E9 | Booth cards printed ×3 (OPERATOR_RUNBOOK Appendix A — updated for Q/R/Tab/V) | ☐ |

## 8. Open risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Supabase mystery backend not deployed**; live station + live board never exercised against the hosted project. | Certain for now / Plan L unavailable | Owner deploys by Oct 25 per OPERATOR_RUNBOOK §3 (exact order: DB → all functions in one command → frontend, no open session) and rehearses; otherwise Plan D. |
| R2 | **Human pacing unverified.** Bots finish in 110–228 s of active play; human door-to-door 4–7 min is an estimate. Controls/objective comprehension within 20 s untested with students. | Medium / throughput, fun | ≥ 10 human playtests on Oct 25–26; if sessions run long, the designer's knobs (MYSTERY_DESIGN §10.7) — but **no code changes on event day**. |
| R3 | **Performance on the real event laptops measured only by proxy.** 60 fps on this i7-11800H/Intel UHD; at 2× CPU throttling the median still holds 60 fps (p95 ≤ 50 ms); at 4× frame times rise to p50 33–83 ms (see §4). The bottleneck is main-thread CPU (script in the frame loop), so **Low graphics barely helps**. | Unknown hardware / stutter on weak laptops | E4 on the real laptops on Oct 25–26. If they stutter: close every other app, AC power, Best performance power mode, 60 Hz, High-performance GPU; fewer background processes. The cheap renderer fix in §10 P1 should land before the freeze. |
| R4 | **Plan D board cannot see the stations.** | Certain in Plan D / spectator value | OPERATOR_RUNBOOK §4.1a options (model-card display, third demo station, paper list, post-event export). |
| R5 | **Uncommitted tree / no freeze commit**; other agents still editing `src/**`. | High / mismatched builds across laptops | Freeze commit, one build, same `dist/` on all three laptops, fingerprint compared. |
| R6 | Venue network blocks WebSockets / client isolation. | Medium (Plan L) | Venue test on Oct 26, hotspot, Plan D fallback (§4.7). |
| R7 | Measurements taken while other agents loaded the CPU (71–83 % busy). | — | Re-measure on a quiet machine or the event laptops (E4). |

## 9. Owner's exact steps

**Sat Oct 24 – Sun Oct 25 (before the freeze)**
1. Commit the overhaul when the agents are done: `git status --short` empty → `git rev-parse --short HEAD` → write it in S11.
2. `npm ci && npm run test:all && npm run build && node scripts/kiosk/check-dist-keys.mjs` on that commit.
3. Decide Plan L: if yes, run OPERATOR_RUNBOOK §3 yourself (approval → dry-run lists 6 migrations → `db push` → verify →
   no session open → `functions deploy` of all six → rebuild/redistribute → hard reload → live rehearsal → delete TEST rows).
4. Copy the repo folder (with `dist/` and `node_modules/`) to Laptops 1–3 and the USB stick; compare the `dist`
   fingerprint on each laptop: in Git Bash `cd dist && find . -type f | sort | xargs sha256sum | sha256sum`.
5. On each laptop: THREE_LAPTOP_RUNBOOK §1 until `check-laptop.ps1` (Plan D: `-SkipSupabase`) shows 0 FAIL.
6. Rehearsal on the real laptops: both stations + Laptop 1, all three cases, note the frame rate (E4), ≥ 10 human
   playtests with door-to-door times (E6). Then clear the Plan D rehearsal data (OPERATOR_RUNBOOK §2 step 5).
7. Final decision Plan L / Plan D by Sun Oct 25 evening.

**Mon Oct 26 (venue day-before)**
8. Venue Wi-Fi + captive portal on all three laptops; Plan L: live board badge not OFFLINE, Realtime connected;
   hotspot pre-joined. 30-minute idle soak (E7). Print 3 booth cards. Pack the kit (THREE_LAPTOP_RUNBOOK §3).

**Tue Oct 27 (event day)**
9. T−60 min: OPERATOR_RUNBOOK §4.1 opening checks on each laptop (`check-laptop.ps1`, `serve-dist.cmd`, launchers —
   `-Live` only in Plan L, quick TEST run + Leave the case).
10. During the event: §4.4 between visitors (New investigation), §4.5 stuck station, §4.7 network failure → Plan D. **No
    code changes, no deploys, no browser updates on event day.**
11. End of day: §4.11 export first (Plan L SQL exports / Plan D `copy(localStorage.getItem('raven.mystery.records'))` on each
    laptop), then clean up; tag `event-2026-10-27`.

## 10. Problems found outside deployment-engineer files (for their owners)

| # | Owner (contract) | File(s) | Symptom | Suggested fix |
|---|---|---|---|---|
| P1 | 3d-artist | `src/three/mystery/vfx.ts:22, 84, 153, 197, 242, 351`, `src/three/mystery/hazards.ts:157`, `src/three/mystery/world.ts:88, 148, 209, 291` | Transparent `side: THREE.DoubleSide` materials without `forceSinglePass`. three r170 (`WebGLRenderer.renderObject`) then draws each such mesh **twice** (BackSide, FrontSide) and sets `material.needsUpdate = true` twice per draw → `WebGLPrograms.getParameters` / `getProgramCacheKey` / `getProgram` run every frame (≈ 3–5 % of throttled main-thread time) plus the extra draw calls. Probe (`output/deploy-probe-materials.mjs`): 4–5 materials' `version` grows by 2–6 per frame in every case; light set stable. | Add `forceSinglePass: true` to these materials (additive / `depthWrite: false` effects gain nothing from the two-pass ordering), or use `FrontSide` where the back is never seen. Re-run the probe: hot materials = 0. |
| P2 | frontend-developer (+ 3d-artist) | `src/ui/mystery/map/mapRender.ts` (minimap draw), `src/ui/mystery/hud/Compass.tsx`, `src/ui/mystery/hud/Minimap.tsx`, `lowGraphics` in `src/app/settings.ts` | **Low graphics does not reduce main-thread CPU**; under 4× CPU it gives no gain (§4). The compass and minimap canvas redraw with `measureText` on constant labels every frame (≈ 5 % of main thread). | When `lowGraphics` is on, also redraw the minimap at ≤ 15 Hz and the compass only when heading/markers change; cache `measureText` widths per (font, label). Low-risk, CPU-only. |
| P3 | frontend-developer / fullstack-developer | header in `src/app/mystery/liveDashboard.tsx` (`mdash__head--kpi`) + `src/ui/styles/dashboard.css` | **Live board header overlap (Plan L only)**: the 5th KPI tile "Hyde chases / run" sits under the "Live · verified" badge — 63×28 px at 1366×768, 84×28 px at 1920×1080 (`output/deploy-board-layout.mjs`, screenshots `L-board-*-live.png`, `D1-…`). The Plan D board has no overlap. | Let the KPI ribbon shrink/wrap (`min-width: 0`, flex-wrap) or move the mode/connection badges to their own row. |
| P4 | frontend-developer | `src/ui/mystery/MysteryDashboard.tsx:451` | Empty-state copy: with **0 runs** the Diagnostic panel says "WHY CASES STAYED UNSOLVED (0 RUNS) · Every finished case was solved." | Show "No finished runs yet." when there are no finished runs. |
| P5 | frontend-developer | `src/ui/mystery/stationView.ts` (fed by `src/app/mystery/liveDashboard.tsx`) | When the live board is OFFLINE (never loaded), station cards read **"Idle · No visitor yet"** — a claim the board cannot know. | While `connection === 'offline' && !loaded`, show "Unknown — board offline" instead of Idle. |
| P6 | orchestrator | whole tree | **No freeze commit**: HEAD `2842ec1` + 173 uncommitted paths (incl. the regenerated `supabase/functions/_shared/**`). The deployed functions must match the browser byte-for-byte. | Commit after the code-review fixes; rebuild; record the id in §7 S11. |
| P7 | (owner decision) | `src/three/pokemonModels/providers.ts` | With internet, a Galarian Corsola companion triggers one request to `pokemon-3d-api.onrender.com` (30 s timeout; ends on artwork anyway). Harmless, but it is the only third-party request at runtime. | Optional: build with `VITE_POKEMON_MODEL_PROVIDERS=local` (or accept). Not a blocker. |

## 11. Reproduce

```bash
npm run build && node scripts/kiosk/check-dist-keys.mjs
npx vite preview --port 4174 --strictPort             # any free port except the 5173 dev server
BASE=http://localhost:4174 node output/deploy-offline.mjs
BASE=http://localhost:4174 VISITORS=3 node output/deploy-two-station.mjs
BASE=http://localhost:4174 DRIVER=bot RATES=1,4 node output/deploy-perf.mjs     # and DRIVER=keys RATES=2,4
BASE=http://localhost:4174 RATE=4 DRIVER=keys node output/deploy-profile.mjs
BASE=http://localhost:4174 node output/deploy-probe-materials.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk\check-laptop.ps1 -SkipSupabase
```
