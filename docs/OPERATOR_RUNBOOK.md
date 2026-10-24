# Operator runbook — Nevermore: Deadly Secrets (Raven Island mystery, rules `mystery-v3.1`, overhaul 2026-10-23)

School Halloween arcade, **Tuesday Oct 27, 2026**. Exactly three Windows laptops:
**Laptop 1** = spectator board + operator console, **Laptops 2 and 3** = player stations A and B (independent,
concurrent, fullscreen kiosks, keyboard + mouse). Backend: Supabase project `abkohhdjlufhsbqrchpn` (ap-northeast-1).

Hardware / Windows / network checklist: [`THREE_LAPTOP_RUNBOOK.md`](THREE_LAPTOP_RUNBOOK.md). GO / NO-GO with evidence
and the owner's event-day steps: [`overhaul/DEPLOY_READINESS.md`](overhaul/DEPLOY_READINESS.md). Printable volunteer
card: [Appendix A](#appendix-a--booth-card-print-this-page). Never write keys or passwords into any file, chat, booth
card or sticky note — keep them in the owner's password manager.

---

## 0. Status on 2026-10-24 — read first

| Piece | State |
|---|---|
| Overhauled game at `/` (compass, minimap, odds panel, Q/R abilities, Tab investigation map, three distinct cases) | Production build passes; plays end-to-end **offline** (every internet request blocked) on this laptop — DEPLOY_READINESS §2. **Not committed yet** (no freeze commit). |
| Live station kiosk `/?mode=terminal&station=station_a\|station_b` (sign-in gate, server-issued session/offer, sync chip, verified result) | Landed in the frontend. Tested only against the fake project (`tests/integration`), **never against the hosted project**. Offline it shows the sign-in gate with **Play LOCAL DEMO (unverified)**. |
| Live board `/?mode=dashboard` (Realtime station cards, verified standings, operator sign-in + Reset station) | Landed. Offline it shows "OFFLINE" + "Live data could not be refreshed…" and retries. |
| Mystery backend: **6 migrations** `20261021000500…800`, `20261022000100`, `20261023000100` + 6 functions (`mystery-*` ×5, extended `admin-reset`) | Built, tested offline. **NOT deployed — waits for the owner's approval** (§3). |
| v2.5 backend | Deployed and live (legacy routes, `&legacy=1`). |
| Human playtests of the overhaul | **0.** Bot timings only (§4.2). |

Two ways to run the day. **Decide by Sun Oct 25, evening**, after a full rehearsal on the real laptops:

- **Plan L (live, verified)** — needs: freeze commit → owner approval → §3 deploy (exact order) → rebuild + hard reload →
  station sign-in → rehearsal with both stations and Laptop 1. Gives the verified leaderboard, the live Laptop 1 board
  (both stations' progress), operator Reset station.
- **Plan D (LOCAL DEMO)** — works today, no network at all. Each station plays and shows its own results + the four
  analytics; nothing reaches the verified leaderboard. **Laptop 1 can only show runs played in its own browser**
  (§4.1a). Also the automatic fallback in §4.7 if the network dies during Plan L.

**Owner actions:** commit the overhaul (freeze commit); approve (or not) the mystery deploy and run §3 yourself; decide
Plan L / Plan D; run ≥ 10 human playtests + the two-station rehearsal on the real laptops; decide on the leftover v2.5
"LiveTest" entry; confirm the portrait-rights caveat (DECISIONS D-30/D-34); supply the official rubric.

---

## 1. Build and hosting

### 1.1 `.env` (build machine only; git-ignored)

`.env` or `.env.local` in the repo root contains **exactly** these two browser-safe values:

```dotenv
VITE_SUPABASE_URL=https://abkohhdjlufhsbqrchpn.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key: Dashboard > Project Settings > API Keys>
```

**Never** in any `.env`/`VITE_` variable or file: the `service_role` / `sb_secret_…` key, the database password,
`SUPABASE_ACCESS_TOKEN`, station/operator passwords. Vite inlines every `VITE_` value into the public bundle (the app
also refuses to start live mode with a privileged key, but by then it is published — rotate it and rebuild). Values are
baked in at build time: rebuild after changing them. `/` is always LOCAL DEMO; only `/?mode=terminal&station=…` and
`/?mode=dashboard` use these values.

### 1.2 Build (on the freeze commit)

```bash
cd /d/PokemonDay
git status --short                       # must be empty: build only a committed tree (the "freeze commit")
npm ci                                   # once per machine / after package-lock changes
npm run test:all                         # typecheck + functions typecheck + vitest + supabase unit
npm run build                            # = sync:shared -> tsc -> vite build -> dist/   (≈ 35 s, no warnings expected)
git status --short                       # still empty? sync:shared rewrites supabase/functions/_shared/** — commit any change
node scripts/kiosk/check-dist-keys.mjs   # must end "No privileged keys found." (never prints a key)
git rev-parse --short HEAD               # write this commit id into DEPLOY_READINESS
```

`dist/` is ~23 MB (3.4 MB JS/CSS/fonts, 13 MB 3D models, 5.5 MB art, 1.3 MB audio, 0.25 MB Draco decoder); nothing is
loaded from a CDN. The deployed functions must match the browser byte-for-byte (same commit; §3).

### 1.3 Serving `dist/` (pick one; all routes are query strings on `/`, so any static server works)

| Option | How | Pros / cons |
|---|---|---|
| **A. Local server on every laptop (recommended)** | Copy the repo folder **with `dist/` and `node_modules/`** to each laptop (or build on each from the same commit), then double-click `scripts\kiosk\serve-dist.cmd` → `http://localhost:4173` | `localhost` is a secure context (keyboard lock works); no laptop-to-laptop traffic; a dead laptop affects only itself. Same commit on all three. |
| B. HTTPS static host | Upload `dist/` to the **root** of a static host. Launch with `-BaseUrl https://<host>` | Needs internet to even load the page (useless for Plan D). Must be the domain root (`/assets`, `/art`, `/models`, `/draco`). |
| C. Laptop 1 serves the LAN | `scripts\kiosk\serve-dist.cmd lan` on Laptop 1; stations launch with `-BaseUrl http://<laptop-1-ip>:4173` (launcher adds the secure-context flag) | Single point of failure; school Wi-Fi often isolates clients; firewall must allow Node on *Private*. Does **not** share LOCAL DEMO data between laptops. |

Equivalent command for A/C without the `.cmd`: `npx vite preview --port 4173 --strictPort [--host]`. Never use
`npm run dev` at the event.

---

## 2. Pre-event setup per laptop (app level)

Do [`THREE_LAPTOP_RUNBOOK.md`](THREE_LAPTOP_RUNBOOK.md) §1–§2 first: Sticky/Filter Keys shortcuts OFF, sleep Never,
updates paused, notifications off, scale 100 %, **60 Hz**, Chrome/Edge on the High-performance GPU, mouse acceleration
off, sound ~60 %, browser zoom 100 %. `scripts\kiosk\check-laptop.ps1` (Plan D: add `-SkipSupabase`) must show
**0 FAIL**.

Browser: Chrome (or Edge) current stable, ≥ 120. The launcher (`scripts\kiosk\launch-kiosk.ps1`, wrapped by the `.cmd`
files) uses a dedicated profile per role in `%LOCALAPPDATA%\RavenIslandKiosk\<role>` and these flags:
`--kiosk` (stations) / `--start-fullscreen --app=` (dashboard), `--disable-pinch`, `--overscroll-history-navigation=0`,
`--no-first-run`, `--disable-features=Translate,TranslateUI,OverscrollHistoryNavigation`,
`--autoplay-policy=no-user-gesture-required`, no background throttling, crash-restore bubble suppressed, and
`--unsafely-treat-insecure-origin-as-secure=<origin>` only for a plain-HTTP LAN host. `-DryRun` prints the exact
command, `-Window` opens a normal window on the same profile (sign-in help, DevTools export, Ctrl+0), `-ForceScale1`
if Windows scaling can't be 100 %. Alt+F4 closes a kiosk.

| Laptop | Plan D (LOCAL DEMO) | Plan L (after §3) |
|---|---|---|
| 2 · Station A | `start-station-a.cmd` → `http://localhost:4173/` | `start-station-a.cmd -Live` → `/?mode=terminal&station=station_a` |
| 3 · Station B | `start-station-b.cmd` → `/` | `start-station-b.cmd -Live` → `/?mode=terminal&station=station_b` |
| 1 · Dashboard | `start-dashboard.cmd` → `/?mode=dashboard&demo=1` | `start-dashboard.cmd -Live` → `/?mode=dashboard` |

(Verified against `src/app/routing.ts` on 2026-10-24: the terminal route opens the **mystery** live kiosk; `&legacy=1`
would open the old v2.5 race.)

### Stations (Laptops 2 and 3)

1. Start the server (option A) — keep its window open (minimised); double-click the station launcher.
2. **Plan L only — station sign-in:** the gate "STATION A · LIVE MODE / Station sign-in" asks for the station account
   (`station_a` on Laptop 2, `station_b` on Laptop 3). The owner types the password; the sign-in persists in that kiosk
   profile. The gate refuses the other station's account. **Do not press "Play LOCAL DEMO (unverified)" in Plan L** — it
   is the explicit offline escape hatch (§4.7).
3. On Home click **Open the case** — this click requests element fullscreen **and keyboard lock** (then Ctrl also
   crouches and Ctrl+W/Esc stay inside the game). Without the lock, C still crouches and Ctrl is ignored by design.
4. Test run per [`THREE_LAPTOP_RUNBOOK.md`](THREE_LAPTOP_RUNBOOK.md) §4 (all keys, Shift ×5, Ctrl+W, one full run).
5. **Plan D — clear rehearsal data** so the end-of-day export only holds event runs: `start-station-a.cmd -Window` →
   F12 → Console →
   `['raven.mystery.session','raven.mystery.records','raven.mystery.live','raven.mystery.caseBag'].forEach(k => localStorage.removeItem(k))`
   → close, relaunch the kiosk. (Same on Laptop 3 and, if it played, Laptop 1.)
6. Visitor settings (look sensitivity, crouch toggle/hold, captions, "Show predictions") reset on every "New
   investigation". **Low graphics** lives in Home's header › Display options (persists per profile) — set it only if the
   laptop stutters (§4.8).

### Laptop 1 (dashboard)

1. Launch the dashboard (`-Live` in Plan L). The public board needs no login.
2. **Plan L — operator sign-in** (header › **Operator**) with the operator account — needed for **Reset station** and
   the event-level analytics panels only.
3. Keep the Supabase dashboard (owner) on a separate browser profile on a second virtual desktop (Win+Ctrl+D), never
   on the public screen.
4. Plan L check: both station cards appear, "Signal lost" clears within 15 s of each station loading, the connection
   badge is not "OFFLINE".

---

## 3. Plan L backend deploy — OWNER ONLY, ONLY AFTER APPROVAL

> Nobody but the owner runs this section, and only with the owner's explicit, recorded approval (who, when). Target
> **Oct 24–25**, then rehearse. **Not on event day.** Everything is additive; v2.5 tables, rows and functions keep
> working. Source of truth: [`SUPABASE_SETUP.md` §12.2 + §12.7](SUPABASE_SETUP.md). **Order: database → ALL mystery
> functions in one command → frontend, with no mystery session open across the switch.**

1. [ ] Approval recorded: ______ (name) ______ (date/time).
2. [ ] Clean, committed tree on the freeze commit; tag it: `git tag mystery-v3.1-overhaul-deploy && git rev-parse --short HEAD`.
3. [ ] Log in and link (owner's terminal; database password typed at the prompt, never saved):
   `npx supabase login` → `npx supabase link --project-ref abkohhdjlufhsbqrchpn`
4. [ ] Generated copies + tests:
   ```bash
   npm run sync:shared
   npm run typecheck:functions && npm run test:supabase-unit && npm run test:db:offline && npm run test:db:roundtrip
   git status --short          # sync:shared must not have changed anything uncommitted
   ```
5. [ ] `npx supabase db push --dry-run` — must list **exactly these six, in this order** (the v2.5 ones are applied):
   ```
   20261021000500_mystery_schema.sql
   20261021000600_mystery_rls_and_grants.sql
   20261021000700_mystery_rpcs.sql
   20261021000800_mystery_realtime.sql
   20261022000100_mystery_cases.sql
   20261023000100_mystery_overhaul.sql
   ```
   Anything else listed (or one missing) → **STOP**, ask the developer.
6. [ ] **Database first:** `npx supabase db push`
7. [ ] Verify in Dashboard › SQL Editor:
   ```sql
   select station_id, status from public.mystery_station_status;          -- station_a, station_b: idle
   select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
   -- exactly: leaderboard_entries, mystery_results, mystery_station_status, station_status
   select count(*) from public.sessions;                                   -- unchanged v2.5 history
   select pg_get_constraintdef(oid) from pg_constraint
    where conname in ('mystery_events_type_check', 'mystery_forecasts_target_check');
   -- lists include hyde_emerged … hazard_triggered and egg_site, clue_area, hyde_zone, hyde_spawn
   select has_column_privilege('anon', 'public.mystery_results', 'accused', 'SELECT');   -- false
   ```
8. [ ] **No session open:** both stations idle (or closed). A session created before the function deploy can never be
   verified afterwards (`409 CASE_OUTDATED`, by design).
9. [ ] **All mystery functions in ONE command** (they share `_shared/` and the case versions; mixing old and new answers
   `409 CASE_OUTDATED` for every session):
   ```bash
   npx supabase functions deploy --use-api \
     mystery-create-session mystery-get-session mystery-select-duo mystery-append-events mystery-finalize admin-reset
   ```
   No new secrets. Leave `MYSTERY_ALLOW_TEST_SEEDS` unset (if set for a seed-reuse test: `npx supabase secrets unset MYSTERY_ALLOW_TEST_SEEDS`).
10. [ ] **Frontend last:** rebuild from the same commit (§1.2), redistribute `dist/` to every laptop, restart
    `serve-dist.cmd`, and **hard-reload all three laptops** (close the kiosk with Alt+F4 and relaunch; an old cached
    bundle would play the old layout).
11. [ ] Rehearsal: both stations play simultaneously with nicknames starting **`TEST`**; each gets its own case from its
    own server-side bag; Laptop 1 shows both live; operator **Reset station** works on both; refresh mid-offer restores
    the same three cards; finished runs appear on the board; the results banner reads "Verified · Rank #…".
12. [ ] Delete the rehearsal results before doors open (owner, SQL Editor):
    `select session_id, nickname, station_id, finalized_at from public.mystery_results where nickname like 'TEST%';` then
    `delete from public.mystery_results where nickname like 'TEST%';` (sessions/events stay, unranked).

**Never** run `supabase db reset --linked`, drop tables, or "repair" migration history to make a push succeed.

### Rollback (fastest first)

1. **Game only, no backend:** stations relaunch without `-Live` → `/` LOCAL DEMO (Plan D); dashboard without `-Live`.
2. **Backend:** previous frontend **and** previous functions together (the overhaul migration is a CHECK superset and
   needs no rollback; SUPABASE_SETUP §12.7 step 5). Leave the additive mystery tables in place (unused, harmless).
3. **Legacy v2.5 live game** (untouched): stations `-Path "/?mode=terminal&station=station_a&legacy=1"` (resp.
   `station_b`); dashboard `-Path "/?mode=dashboard&legacy=1"`.
4. **Whole pre-overhaul build**: the last commit before the overhaul (`2842ec1`, or the pre-v3.1 tag
   `pre-mystery-v3.1` for the rowing build):
   ```bash
   git worktree add ../PokemonDay-rollback 2842ec1
   cd ../PokemonDay-rollback && cp ../PokemonDay/.env . && npm ci && npm run build
   ```
   then serve that `dist/` instead. Dropping mystery objects is an owner decision after the event, never on event day.

---

## 4. Event-day operation

### 4.1 Opening checks (T−60 min → doors)

1. Power strip on, three chargers in, lids open. `check-laptop.ps1` (Plan D: `-SkipSupabase`) → 0 FAIL on each laptop.
2. Plan L: venue Wi-Fi joined (captive portal done); hotspot ready; Supabase line PASS.
3. Servers running (`serve-dist.cmd` window open on each laptop) — minimise, don't close.
4. Launch Laptop 1, then stations. Plan L: gate signed in as the right station; Laptop 1 shows both cards **Idle**.
5. One quick check per station: Open the case → name `TEST` → pick a card → Skip → tutorial Skip (Enter) → walk, Q, R,
   Tab, Esc → **Leave the case** → confirm (no result recorded). Sound audible, M toggles mute.
6. Plan L: no `TEST…` rows on the board (§3 step 12). Plan D: rehearsal data cleared (§2 step 5).
7. Booth cards on both station tables; issue log + pen; paper "unofficial scores" list (Plan D).

### 4.1a What Laptop 1 shows

- **Plan L:** live station cards (phase, active time, duo, case, clue/egg/tower progress, HP, chases, Hyde state, risk,
  Thing's latest item, heartbeat age), KPI ribbon (runs, case solved %, extraction %, median time, chases per run),
  verified standings (all cases + per case), the four analytics panels. Never the culprit, the accusation or the true
  egg site.
- **Plan D:** the same screen, but fed **only by runs played in Laptop 1's own browser**. Stations 2 and 3 keep their
  data in their own browsers; nothing crosses laptops (not via Wi-Fi, not via a shared server — browser storage stays on
  its machine). Station B's card reads "Both stations appear here live once the Supabase backend is deployed".
  Rehearsal 2026-10-24: both stations finished 3 runs each; the board in its own profile showed **0 runs**; the same board
  opened inside station A's profile showed exactly station A's 3 runs. Options in Plan D: (a) leave Laptop 1 on the board
  as a "how the analytics work" display with the model card; (b) let Laptop 1 be a third demo station during quiet
  times — its board then fills with its own runs; (c) keep the paper "unofficial scores" list, read each station's
  results screen; (d) after the event, export each laptop's records (§4.11) and combine them offline.

### 4.2 A visitor session (no forced time limit)

| Step | ≈ time | Volunteer says / does |
|---|---|---|
| Home → **Open the case** (Enter) → nickname (3–15 chars) | 20–30 s | Nicknames are public on the board (Plan L) — first name or nickname only. |
| Three **duo cards** (slot-machine reveal; ← → or 1 2 3, Enter) | 30–40 s | "Each card is a Nightshade + Pokémon. **Q** = character power, **R** = Pokémon move." Cards show HP and what a Hyde grab costs. |
| **Case file** reveal (stacked files → one case is assigned) | ~4 s (Esc skips) | The case is dealt from the station's bag: three visitors in a row get three different cases. |
| Thing's **prologue** | 20–40 s or **Skip intro** (Esc) | — |
| **Tutorial** on the pier (3 steps, Hyde not out yet, clock stopped) | ≤ 20 s, Skip = Enter | See "first 20 s" below. |
| Find **3 clues** → find + pick up the **egg** (E) → carry it to **Iago Tower** → E deposit | bots 2–4 min; humans ~3–5 min (estimate) | "Follow the compass diamonds and the circles on the minimap. **V** = hint. **Tab** = your evidence + map." |
| **Name the culprit** (needs all 3 clues; otherwise "Leave the case unsolved") → cite evidence → confirm | 30–60 s | Never tell them the culprit. |
| Results + four analytics → **New investigation** (Enter) | 20–30 s | Auto-returns home after 45 s idle + a 20 s countdown (any key stays). |

**Typical length:** autopilot bots finish in **~2–4 min of active play** (deployment rehearsals 2026-10-24, 18
runs: 110–228 s; orchestrator acceptance: 118–228 s). Humans are expected at **4–7 min door to door including menus — an ESTIMATE until the human
playtests are done** (design target 5–7 min, MYSTERY_DESIGN §10.7). Plan throughput ≈ 8–12 visitors per station per
hour. Pause, the Investigation overlay (Tab) and the accusation board stop the game clock.

**What students see in the first 20 seconds** (captured from the production build, 2026-10-24, no input):

| t | Screen |
|---|---|
| 0–2 s | Duo intro banner ("The Howling Sleuth · Investigation"); Thing: "Enid and Trevenant. Follow me — quietly."; key card on the left (W A S D, Mouse, Shift LOUD, C, E, Q {power}, R {move}, Tab); HUD already up: objective top-left, compass top, minimap top-right, HP + noise bottom-left, Q/R ability slots bottom-right. |
| ~2–8 s | Step 1 of 3 **"Find 3 clues. Save the egg."** — "Walk with W A S D. Look with the mouse or the arrow keys." Ends after 3 m of walking or 6 s. |
| ~8–14 s | Step 2 of 3 **"Stay quiet. The Hyde hunts by sound."** + "Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound." (crouch with C; Shift is LOUD). |
| ~14–20 s | Step 3 of 3 **"Search with E. Powers: Q and R."** — "Hold E on the crate." + the duo's power and move names. |
| after | Thing's log "Go. Tab shows your evidence."; the Hyde pill counts down **"Hyde emerges in 0:20"**; the Odds panel shows where it may emerge (3 spawn areas, rule-based %) and the most likely clue area (Bayesian %); Thing's advice "Search the {area}." |

The Hyde is never out during the tutorial and never spawns within 25 m of the player.

**Controls (one reference everywhere):** W A S D move · mouse or ← → ↑ ↓ look · **Shift** sprint (LOUD) · **C** crouch
(also **Ctrl** once the kiosk keyboard lock is on) · **E** search / use (hold for long actions; hold E with the egg to
set it down) · **Q** character power (F also works, never shown) · **R** Pokémon move · **Tab** Investigation overlay
(3 evidence slots + north-up map with Hyde / egg / clue odds; pauses; locked during a chase) · **V** ask Thing for a
hint (hints also come by themselves after 40 / 80 / 120 s without progress) · **Esc** pause · **M** mute (Pause only).

### 4.3 What the status words mean

| You see | Where | Meaning | Do |
|---|---|---|---|
| **Hyde emerges in 0:20** | Hyde pill, top centre | The Hyde is not on the island yet (first 20 s of play). | Nothing. |
| **Patrolling / Heard a noise / Searching / CHASING YOU / Losing interest** (+ STUNNED, SLOWED, DISTRACTED, LURED, PETRIFIED tabs) | Hyde pill | Hyde state; red border = chase; the tab shows an ability effect. | Chased: "Hide, crouch, or use Q / R." |
| **Board locked while you're chased** | Station | Tab is blocked during a chase. | Hide first. |
| **ML estimate / Rule-based estimate / Rule-based risk estimate / Bayesian estimate** | Odds panel, Tab map, results | Which method produced the number (honest labels). | Nothing. |
| **Paused · clock stopped** / **Click again to resume** | Station | Mouse capture lost (Esc, Alt+Tab, a pop-up). | Click Resume (again if refused). |
| **Click to look around** | Station, top centre | Pointer not captured yet. | Click the game once. |
| **Live · verified run** | Station sync chip (Plan L) | Events are reaching the server. | Nothing. |
| **Offline · saves locally** | Station sync chip (Plan L) | No server contact; the game keeps running and resends later (duplicates ignored). | Let the visitor finish; fix the network (§4.7); avoid reloading while shown. |
| **Unverified run** / **Not verified — not on the leaderboard** | Station chip / results | The server rejected or never received this run, or LOCAL DEMO. | Tell the visitor it is unofficial; optional paper list marked "unofficial". Never add it to the board by hand. |
| **Local demo: scores aren't verified or ranked live** | Station Home | Plan D. | Expected in Plan D. |
| **Reset by operator** | Station | Laptop 1 reset this station. | Start the next visitor. |
| **Signal lost** | Laptop 1 station card | No heartbeat for > 15 s (Plan D: always for stations 2/3). | Look at the station: window open? asleep? Wi-Fi? |
| **OFFLINE** + "Live data could not be refreshed…" | Laptop 1 header (Plan L) | Laptop 1 can't reach Supabase; it shows the last known state and retries. | §4.7. |

### 4.4 Between visitors (the normal reset)

1. Results → **New investigation** (Enter). Home shows three new cards; the next case is already dealt from the bag.
   Visitor settings reset automatically. Nothing else to do.
2. Visitor walked away on the results: it returns home by itself (45 s idle + 20 s countdown).
3. Visitor walked away mid-run: **Esc → Leave the case → confirm** (not recorded, not ranked).
4. If the previous visitor changed Display options (low graphics, reduced motion) on Home, set them back.

### 4.5 Reset a stuck station

At the station (works in every mode):
1. **Esc → Leave the case → confirm.** Back to Home with three new cards; the run is not recorded/ranked.
2. On results: **New investigation** (Enter).
3. Page frozen: **F5**. Before the island it restores the same three cards and name; on the island (LOCAL DEMO) the run
   restarts from the pier with a fresh clock — let the visitor re-pick the same card.
4. Window gone: double-click the station launcher again (crash bubble is suppressed). Server window closed: run
   `serve-dist.cmd` again first.

From Laptop 1 (Plan L, operator signed in):
5. Station card → **Reset station** → confirm with a reason ("visitor left", "stuck"). Calls `admin-reset` with `scope`
   `all` (default) or `mystery`. The run becomes `abandoned/operator_reset` — unranked, events kept, audited. Never reset
   a run that is going fine.
6. Laptop 1 down: use steps 1–4. A new visitor's session automatically supersedes the old open one (unranked).

### 4.6 Refresh / browser crash recovery

- **Before play (name / cards):** a reload restores the same three cards and name — the offer never rerolls; the case
  stays the same.
- **During play, LOCAL DEMO:** no mid-run save; reload → same cards → the island restarts from the pier.
- **Plan L:** the station fetches its open session (`mystery-get-session`) and offers it back — same cards, case and
  selection. Whether a run continues or restarts: check during the rehearsal and note it here: ______. An `abandoned`
  session simply starts a new visitor.
- "Aw, Snap!" page: **F5**. Laptop rebooted: log in → `serve-dist.cmd` → station launcher.

### 4.7 Network failure (Plan L)

1. **Do not touch the stations.** A run in progress continues; the game runs entirely in the browser.
2. Look at Laptop 1 (OFFLINE badge, "Signal lost") and the station chip ("Offline · saves locally").
3. Check Wi-Fi/captive portal on one laptop; `check-laptop.ps1` Supabase line; <https://status.supabase.com>.
4. Switch all three laptops to the backup hotspot between visitors.
5. Still down after ~10 min: go to **Plan D** between visitors — Alt+F4 the station, relaunch without `-Live` (or press
   **Play LOCAL DEMO (unverified)** on the station gate). Results are unverified; keep the paper list.
6. Network back: relaunch with `-Live` between visitors. Queued live runs resend themselves. Local results are **never**
   inserted into the verified board (there is no API for it, and none should be improvised).

### 4.8 Hyde trouble, stuck player, slow laptop

Simulation: every duo finishes in bot runs, no softlock found — human play is still untested, so:
1. Lost: the compass shows clue-area diamonds and the tower; the minimap shows dashed clue-area circles with %; **V**
   asks Thing (L1 area line → L2 lantern marker on compass + minimap → L3 most likely spot + dotted route).
2. Stuck on geometry: walk back the way you came, crouch-walk, turn with ← →.
3. Hyde close: crouch (C), hide in a niche (eye icon on the minimap), or use **Q** / **R** (stun, distract, decoy…).
   After a chase the Hyde hears less for ~10 s — walk away quietly. Two grabs (or HP 0) end the run (DNF).
4. Egg dropped: the objective says "Egg DROPPED — go back"; walk back and press E.
5. Nothing helps within ~60 s: Esc → Leave the case, offer a fresh run.
6. Stutter: Home → Display options → **Low graphics** (persists for that kiosk profile); close other apps; check the
   charger and the 60 Hz / High-performance GPU settings. Measured proxy numbers: DEPLOY_READINESS §4.
7. Log every incident: time · station · duo · case · what happened · phone photo. **No code changes on event day** —
   only launch flags, resets and Plan D.

### 4.9 Kiosk escapes

- Out of fullscreen / keyboard lock lost: on Home click **Open the case** again (re-arms both). In `--kiosk` the window
  itself stays fullscreen.
- Ctrl+W closed the game: relaunch; tell visitors to crouch with **C**.
- A Windows dialog appeared (Sticky Keys, update, low battery): close it, the game pauses safely; fix the setting after
  the run.
- Alt+Tab / Windows key: the game pauses; click Resume.
- Page zoomed in/out (Ctrl+wheel): Ctrl+0.

### 4.10 Moderation (offensive nickname)

Plan L (owner, SQL Editor):
`select session_id, nickname, station_id, finalized_at from public.mystery_results order by finalized_at desc limit 20;`
then `delete from public.mystery_results where session_id = '<id>';` (results cannot be edited, only removed; every
dashboard updates via Realtime). Plan D: the name is only on that station; start a new run.

### 4.11 End of day — export, then clean up

**Export first.**
- Plan L (owner, Dashboard › SQL Editor; export each result grid as CSV, store outside the repo):
  ```sql
  select * from public.mystery_standings;                                         -- finishers then DNFs
  select * from public.mystery_leaderboard;                                       -- ranked finishers
  select session_id, station_id, nickname, character_id, pokemon_id, case_id, outcome, verdict, score, active_time_s, finalized_at
    from public.mystery_results order by finalized_at;                            -- list columns: select * is refused by design
  select * from public.verified_leaderboard;                                      -- legacy v2.5 board, if used
  ```
  (If a column name differs, open the table in the Table Editor and export it there.)
- Plan D (each laptop that played): `start-station-a.cmd -Window` → F12 → Console →
  `copy(localStorage.getItem('raven.mystery.records'))` → paste into Notepad → save
  `station_a_records_2026-10-27.json` to the USB stick. Same on Laptop 3 (and Laptop 1 if it played). Each browser keeps
  the newest 200 runs.

**Then clean up.**
1. Plan L: sign the stations out and afterwards rotate the station passwords (SUPABASE_SETUP §5) or ban the station
   users (SUPABASE_SETUP §10).
2. `npx supabase secrets list` — if `MYSTERY_ALLOW_TEST_SEEDS` is there: `npx supabase secrets unset MYSTERY_ALLOW_TEST_SEEDS`.
3. Test rows (`is_test = true`) are never ranked or public — keep them (recommended); deleting is the owner's call.
4. **"LiveTest" (v2.5 board) — owner's decision.** Inspect:
   `select session_id, nickname, final_score, verified_at from public.leaderboard_entries where nickname = 'LiveTest';`
   Delete only on the owner's word: `delete from public.leaderboard_entries where session_id = '<id>';`
5. Only after the export: delete kiosk profiles `%LOCALAPPDATA%\RavenIslandKiosk\*` (removes local records + sign-ins).
6. Laptops: resume Windows Update, restore sleep/notifications/Sticky Keys shortcut/refresh rate if wanted.
7. Tag the event build: `git tag event-2026-10-27 <commit>`.

---

## 5. Release checklist

The GO / NO-GO checklist with evidence (commands + results), open risks and the owner's exact event-day steps now live
in [`overhaul/DEPLOY_READINESS.md`](overhaul/DEPLOY_READINESS.md). Tick items there, not here.

---

## Appendix A — Booth card (print this page)

> ### NEVERMORE: DEADLY SECRETS — a Raven Island mystery
> **“Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.”**
>
> **Goal:** find **3 clues** → find the Pokémon **egg** → carry it to **Iago Tower** → **name the culprit**. About 5 minutes.
> Follow the **compass** (top) and the **minimap** (top right). The Hyde comes out after 20 seconds.
>
> | Key | Action | Key | Action |
> |---|---|---|---|
> | **W A S D** | Walk | **E** | Search / pick up / deposit (hold) |
> | **Mouse** or **← → ↑ ↓** | Look | **hold E** with the egg | Set the egg down |
> | **Shift** | Sprint — LOUD | **Q** | Character power |
> | **C** | Crouch — quiet | **R** | Pokémon move |
> | **Tab** | Evidence + map (pauses) | **V** | Ask Thing for a hint |
> | **Esc** | Pause | **M** | Mute |
>
> **Hyde:** a grab costs HP (about 35) and lets you go; two grabs (or HP 0) end the run. Hide, crouch, use **Q** / **R**.
>
> **Score = egg points × 100 − your active seconds.** Egg: Common 1 · Rare 3 · Legendary 6 points. Pause and the
> evidence screen stop the clock. Every finisher ranks above every DNF (negative scores too). Solving the case is shown
> separately — it is not part of the score.
>
> **Reset (volunteer):** Esc → *Leave the case* → confirm → Home. Frozen: **F5**. Window gone: double-click the station
> icon. Results: *New investigation* (Enter). Stuck > 1 min or anything odd → tell the operator at Laptop 1
> (time · station · what happened).
>
> Don't tell players who the culprit is. No food or drinks at the keyboards.
