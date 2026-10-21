# Operator runbook — Escape from Raven Island: The Silent Evidence (rules `mystery-v3.1`)

School Halloween arcade, **Tuesday Oct 27, 2026**. Exactly three Windows laptops:
**Laptop 1** = spectator board + operator console (`/?mode=dashboard`), **Laptops 2 and 3** = player stations A and B
(independent, concurrent, fullscreen kiosks, keyboard + mouse). Backend: Supabase project `abkohhdjlufhsbqrchpn`
(ap-northeast-1).

Hardware/Windows/network checklist: [`THREE_LAPTOP_RUNBOOK.md`](THREE_LAPTOP_RUNBOOK.md). Printable volunteer card:
[Appendix A](#appendix-a--booth-card-print-this-page). Release checklist: [§5](#5-three-laptop-release-checklist-master-prompt-13-g).
Never write keys or passwords into any file, chat, booth card or sticky note — keep them in the owner's password manager.

---

## 0. Status on 2026-10-21 — read first

| Piece | State |
|---|---|
| Mystery game at `/` | Playable end-to-end, **LOCAL DEMO only** (results stay in that browser, badge "Local demo"/unverified). |
| Mystery backend (4 migrations `20261021000500..800`, 5 `mystery-*` functions, extended `admin-reset`) | Built, tested offline. **NOT deployed — waits for the owner's approval** (§3). |
| Live mystery frontend (station sign-in, event sync, "Offline · saves locally", live Laptop 1 feed, reset with scope) | **Not landed yet** (Phase 5). Until it lands, `/?mode=terminal&station=…` and `/?mode=dashboard` still open the **legacy v2.5 race/board**. |
| v2.5 backend | Deployed and live (legacy routes). |
| Laptop 1 mystery board today | `/?mode=dashboard&demo=1` shows **only runs played in Laptop 1's own browser** — it cannot see stations 2/3 in LOCAL DEMO. |

So there are two ways to run the day. Decide by **Oct 25** after a full rehearsal:

- **Plan L (live, verified)** — needs: owner approval → §3 deploy → live frontend merged → rehearsal with both stations
  and Laptop 1. Verified leaderboard, live dashboard, operator reset.
- **Plan D (LOCAL DEMO fallback)** — works today with no network. Each station plays and shows its own results +
  four analytics; Laptop 1 shows the analytics/model card of its own demo runs or a paper "unofficial scores" list.
  Nothing reaches the verified leaderboard. Also the automatic fallback in §4.6 if the network dies.

**Owner actions:** approve (or not) the mystery deploy; supply the anon/publishable key into `.env` on the build machine
(already present on the dev laptop); decide on the leftover v2.5 "LiveTest" entry; run ≥ 10 human playtests and the
two-station rehearsal on the real laptops; confirm portrait rights caveat (DECISIONS D-30/D-34); supply the official rubric.

---

## 1. Build and hosting

### 1.1 `.env` (build machine only; git-ignored)

`.env` or `.env.local` in the repo root contains **exactly** these two browser-safe values:

```dotenv
VITE_SUPABASE_URL=https://abkohhdjlufhsbqrchpn.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key: Dashboard > Project Settings > API Keys>
```

**Never** in any `.env`/`VITE_` variable or file: the `service_role` / `sb_secret_…` key, the database password,
`SUPABASE_ACCESS_TOKEN`, station/operator passwords. Vite inlines every `VITE_` value into the public bundle. (The app
also refuses to start live mode with a privileged key, but by then the key is already published — if that ever happens,
rotate the key in the Supabase dashboard and rebuild.) Values are baked in at build time: rebuild after changing them.
Blank values = LOCAL DEMO everywhere. Note: the mystery route `/` is LOCAL DEMO regardless of `.env` until the live
frontend lands.

### 1.2 Build (on the freeze commit)

```bash
cd /d/PokemonDay
npm ci                                   # once per machine / after package-lock changes
npm run test:all                         # typecheck + functions typecheck + vitest + supabase unit
npm run build                            # = sync:shared -> tsc -> vite build -> dist/
node scripts/kiosk/check-dist-keys.mjs   # must end "No privileged keys found." (never prints a key)
git rev-parse --short HEAD               # write this commit id into the release checklist
```

`npm run build` re-runs `sync:shared`, which regenerates `supabase/functions/_shared/**`. If that changes files, commit
them — the deployed functions must match the browser byte-for-byte (redeploy, §3). Checked 2026-10-21: the current
`dist/` and `.env` contain only the anon JWT key for ref `abkohhdjlufhsbqrchpn`.

### 1.3 Serving `dist/` (pick one; all routes are query strings on `/`, so any static server works)

| Option | How | Pros / cons |
|---|---|---|
| **A. Local server on every laptop (recommended)** | Copy the repo folder **with `dist/` and `node_modules/`** to each laptop (or build on each), then double-click `scripts\kiosk\serve-dist.cmd` → `http://localhost:4173` | `localhost` is a secure context (keyboard lock works); no laptop-to-laptop traffic; a dead laptop affects only itself. Same commit on all three. |
| B. HTTPS static host | Upload `dist/` to the **root** of a static host (Netlify / Cloudflare Pages / Vercel…). Launch with `-BaseUrl https://<host>` | No server window; needs internet to even load the page. Must be the domain root (assets use `/assets`, `/art`). Leave `ALLOWED_ORIGINS` unset unless you list every origin in use. |
| C. Laptop 1 serves the LAN | `scripts\kiosk\serve-dist.cmd lan` on Laptop 1; stations launch with `-BaseUrl http://<laptop-1-ip>:4173` (launcher adds the secure-context flag) | Single point of failure; school Wi-Fi often isolates clients; Windows Firewall must allow Node on *Private* networks. Test at the venue first. |

Equivalent command for A/C without the `.cmd`: `npx vite preview --port 4173 --strictPort [--host]` (`npm run preview`
= `vite preview --host`, LAN-exposed). Do not use `npm run dev` at the event.

---

## 2. Pre-event setup per laptop (app level)

Do [`THREE_LAPTOP_RUNBOOK.md`](THREE_LAPTOP_RUNBOOK.md) §1–§2 first (Sticky/Filter Keys shortcuts OFF, no sleep,
updates paused, notifications off, 100 % scaling, 60 Hz, high-performance GPU, mouse acceleration off, sound ~60 %).
`scripts\kiosk\check-laptop.ps1` must show **0 FAIL**.

Browser: Chrome (or Edge) current stable, ≥ 120. The launcher (`scripts\kiosk\launch-kiosk.ps1`, wrapped by the `.cmd`
files) uses a dedicated profile per role in `%LOCALAPPDATA%\RavenIslandKiosk\<role>` and these flags:
`--kiosk` (stations) / `--start-fullscreen --app=` (dashboard), `--disable-pinch`, `--overscroll-history-navigation=0`,
`--no-first-run`, `--disable-features=Translate,TranslateUI,OverscrollHistoryNavigation`,
`--autoplay-policy=no-user-gesture-required`, no background throttling, crash-restore bubble suppressed, and
`--unsafely-treat-insecure-origin-as-secure=<origin>` only for a plain-HTTP LAN host. Add `-DryRun` to print the exact
command, `-Window` for a normal window on the same profile (sign-in help, DevTools export), `-ForceScale1` if Windows
scaling can't be 100 %. Alt+F4 closes a kiosk.

| Laptop | Today (Plan D) | After deploy + live frontend (Plan L) |
|---|---|---|
| 2 · Station A | `start-station-a.cmd` → `http://localhost:4173/` | `start-station-a.cmd -Live` → `/?mode=terminal&station=station_a` |
| 3 · Station B | `start-station-b.cmd` → `/` | `start-station-b.cmd -Live` → `/?mode=terminal&station=station_b` |
| 1 · Dashboard | `start-dashboard.cmd` → `/?mode=dashboard&demo=1` | `start-dashboard.cmd -Live` → `/?mode=dashboard` |

**Before using `-Live` on stations, confirm in `src/app/routing.ts` that the terminal route opens the mystery game**
(on 2026-10-21 it still opens the legacy race). If the final route differs, change the one `$LiveStationPath` line in
`launch-kiosk.ps1`.

### Stations (Laptops 2 and 3)

1. Start the server (option A) or confirm the hosted URL loads; double-click the station launcher.
2. **Plan L only — station sign-in:** the first live launch asks for the station account (`station_a` account on
   Laptop 2, `station_b` on Laptop 3). The owner types the password from the password manager; it is never written
   down. The sign-in persists in that kiosk profile. The header must read **Station A** / **Station B**; if it shows
   the wrong station, sign out and sign in with the right account.
3. On Home click **Open the case** — this click requests element fullscreen **and keyboard lock** (then Ctrl may crouch
   and Ctrl+W/Esc stay inside the game). Without the lock, C still crouches and Ctrl is ignored by design.
4. Test run per [`THREE_LAPTOP_RUNBOOK.md`](THREE_LAPTOP_RUNBOOK.md) §4 (all keys, Shift ×5, Ctrl+W, one full run).
5. **Plan D — clear rehearsal data** so the end-of-day export only holds event runs: `start-station-a.cmd -Window`, F12 →
   Console → `['raven.mystery.session','raven.mystery.records','raven.mystery.live'].forEach(k => localStorage.removeItem(k))`
   → close, relaunch the kiosk.
6. Visitor settings (look sensitivity, crouch toggle/hold, reduced motion) reset on every "New investigation".
   Low graphics lives in the Home header's Display options (persists) — set it only if the laptop stutters.

### Laptop 1 (dashboard)

1. Launch the dashboard (`-Live` in Plan L). The public board needs no login.
2. **Plan L — operator sign-in** with the operator account (password manager) — needed for **Reset station** and the
   detailed analytics panels only.
3. Keep the Supabase dashboard (owner) on a separate browser profile on a second virtual desktop (Win+Ctrl+D), never on
   the public screen.
4. Check: both station cards appear, "Signal lost" clears within 15 s of each station loading, connection badge
   connected.

---

## 3. Deploy mystery-v3.1 — ONLY AFTER THE OWNER APPROVES

> Do not run any step of this section without the owner's explicit, recorded approval (who, when). Not on event day.
> Target: deploy by **Oct 24–25**, then rehearse. Everything is additive; v2.5 tables, rows and functions keep working.

1. [ ] Approval recorded: ______ (name) ______ (date/time).
2. [ ] Clean, committed tree on the freeze commit; tag it: `git tag mystery-v3.1-deploy && git rev-parse --short HEAD`.
3. [ ] Log in and link (owner's terminal; database password typed at the prompt, never saved):
   `npx supabase login` → `npx supabase link --project-ref abkohhdjlufhsbqrchpn`
4. [ ] Generated copies + tests (SUPABASE_SETUP §12.2):
   ```bash
   npm run sync:shared
   npm run typecheck:functions && npm run test:supabase-unit && npm run test:db:offline && npm run test:db:roundtrip
   ```
5. [ ] `npx supabase db push --dry-run` — must list **only** `20261021000500`, `…600`, `…700`, `…800`.
   Anything else listed → **STOP**, ask the developer.
6. [ ] `npx supabase db push`
7. [ ] `npx supabase functions deploy --use-api mystery-create-session mystery-get-session mystery-select-duo mystery-append-events mystery-finalize admin-reset`
   (No new secrets. Leave `MYSTERY_ALLOW_TEST_SEEDS` unset; if set for a seed-reuse test, unset it afterwards:
   `npx supabase secrets unset MYSTERY_ALLOW_TEST_SEEDS`.)
8. [ ] Verify in Dashboard › SQL Editor:
   ```sql
   select station_id, status from public.mystery_station_status;          -- station_a, station_b: idle
   select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
   -- exactly: leaderboard_entries, mystery_results, mystery_station_status, station_status
   select count(*) from public.sessions;                                   -- unchanged v2.5 history
   ```
9. [ ] Rebuild the frontend from the same commit (§1.2) and redistribute `dist/` to every laptop / the host.
10. [ ] Rehearsal: both stations play simultaneously with nicknames starting **`TEST`**; Laptop 1 shows both live;
    operator **Reset station** works; refresh mid-offer restores the same three cards; finished runs appear on the board.
11. [ ] Delete the rehearsal results before doors open (owner, SQL Editor):
    `select session_id, nickname, station_id, finalized_at from public.mystery_results where nickname like 'TEST%';` then
    `delete from public.mystery_results where nickname like 'TEST%';` (sessions/events stay, unranked).

**Never** run `supabase db reset --linked`, drop tables, or "repair" migration history to make a push succeed.

### Rollback (fastest first)

1. **Game only, no backend:** stations relaunch without `-Live` → `/` mystery LOCAL DEMO (Plan D).
2. **Legacy v2.5 live game (still deployed, untouched by the mystery migrations):** stations `-Path "/?mode=terminal&station=station_a"`
   (resp. `station_b`) with the frontend build that still routes it to v2.5; dashboard `-Path "/?mode=dashboard&legacy=1"`;
   LOCAL DEMO race `/?legacy=1`; v3.0 rowing `/?mode=rowing`.
3. **Whole pre-v3.1 build** (git tag `pre-mystery-v3.1`, the rowing build):
   ```bash
   git worktree add ../PokemonDay-pre-v31 pre-mystery-v3.1
   cd ../PokemonDay-pre-v31 && cp ../PokemonDay/.env . && npm ci && npm run build
   ```
   then serve that `dist/` instead.
4. **Backend:** leave the additive mystery tables/functions in place (unused, harmless). If the extended `admin-reset`
   misbehaves, redeploy the v2.5 version from the tag worktree: `npx supabase link --project-ref abkohhdjlufhsbqrchpn`
   then `npx supabase functions deploy --use-api admin-reset`. Dropping mystery objects is an owner decision after the
   event, never on event day.

---

## 4. Event-day operation

### 4.1 Opening checks (T−60 min → doors)

1. Power strip on, three chargers in, lids open. `check-laptop.ps1` → 0 FAIL on each laptop.
2. Network: venue Wi-Fi joined (captive portal done); hotspot ready. Plan L: Supabase line PASS.
3. Servers running (option A: `serve-dist.cmd` window open on each laptop) — minimise, don't close.
4. Launch Laptop 1, then stations. Plan L: header shows the right station; Laptop 1 shows both cards **Idle**.
5. One quick check per station: Open the case → name `TEST` → pick a card → tutorial → Esc → **Leave the case** →
   confirm (no result recorded). Sound audible, M toggles.
6. Plan L: no `TEST…` rows left on the board (§3 step 11).
7. Booth cards on both station tables; issue log + pen ready.

### 4.2 A visitor session (≈ 6 min, no forced time limit)

| Step | ≈ time | Volunteer |
|---|---|---|
| Home → **Open the case** (Enter) | 25 s | "WASD walk, mouse looks, **C** crouch, **E** use. The Hyde hunts by sound." |
| Name (3–15 chars) | | Nicknames are public on the board — first name or nickname only. |
| Pick one of **three duo cards** (← → / 1 2 3, Enter) | 40 s | "Each card is a Nightshade + Pokémon. F = character power, Q = Pokémon move." |
| Thing tutorial (skippable, Enter) | ≤ 25 s | Shows “Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.” |
| Find 3 clues (Research Room, Crypt Entrance, Egg Chamber) | ~2–3 min | Tab = evidence board (pauses), V = Thing hint. |
| Pick up egg (E) → carry to **Iago Tower** → E deposit | ~1–2 min | Carrying is slower/louder; hold E 0.8 s sets it down. |
| Accuse one suspect (or leave unsolved) | | Never tell them the culprit. |
| Results + four analytics → **New investigation** (Enter) | 25 s | Auto-returns home after 45 s idle + 20 s countdown. |

Bot playtests took ~190–200 s of active play; real visitors are not measured yet. Throughput ≈ 8–10 visitors per
station per hour.

### 4.3 What the status words mean

| You see | Where | Meaning | Do |
|---|---|---|---|
| **Signal lost** | Laptop 1 station card | No status update from that station for > 15 s. In Plan D this is normal for stations 2/3 (the demo board only sees its own browser). | Look at the station: window open? asleep? Wi-Fi? Relaunch if needed. |
| **Offline · saves locally** | Station HUD chip (live mode) | The station can't reach Supabase. The game keeps running; events queue in the browser and are resent (duplicates ignored). | Let the visitor finish. Fix the network (§4.6). Avoid reloading while the chip shows. |
| **Not verified** / **Unverified** / **Local demo** | Station results / header | This result exists only in this browser: LOCAL DEMO, a run that never synced, or a run the server rejected. It is **not** on the verified leaderboard. | Tell the visitor it is unofficial; optionally write it on the paper list marked "unofficial". Never add it to the board by hand. |
| **Reset by operator** | Station | Laptop 1 reset this station. | Start the next visitor. |
| **Paused · clock stopped** / **Click again to resume** | Station | Mouse capture lost (Esc, Alt+Tab, a pop-up). The clock does not run. | Click Resume (click again if refused). |
| **ML estimate** / **Rule-based risk estimate** | HUD risk chip, results | Which predictor is active (honest labelling). | Nothing. |
| **Board locked while you're chased** | Station | Tab is blocked during a chase. | Hide first. |

"Offline · saves locally" and "Not verified" are the wording specified for the live frontend (UX_MYSTERY §4); confirm
the exact text during the Plan L rehearsal.

### 4.4 Reset a stuck station

At the station (works in every mode):
1. **Esc → Leave the case → confirm.** Back to Home with three new cards; the run is not recorded/ranked.
2. On results: **New investigation** (Enter).
3. Page frozen: **F5**. It reloads to the **same three cards** (name kept) and the run restarts from the start. For a
   new visitor: pick any card → Esc → Leave the case → Home.
4. Window gone: double-click the station launcher again (crash bubble is suppressed).

From Laptop 1 (Plan L, operator signed in):
5. Station card → **Reset station** → confirm with a reason ("visitor left", "stuck"). This calls `admin-reset` with
   `scope` = `all` (default: the station's legacy race **and** its mystery session) or `mystery` (mystery only). The run
   becomes `abandoned/operator_reset` — unranked, events kept for analytics, audited in `operator_audit`. Never reset a
   run that is going fine.
6. Laptop 1 down: use steps 1–4. A new visitor's session automatically supersedes the old open one (unranked).

### 4.5 Refresh / browser crash recovery

- **Before play (name / cards):** a reload restores the same three cards and name — the offer never rerolls.
- **During play, LOCAL DEMO:** no mid-run save; the reload returns to the same three cards and the island restarts
  from the beginning with a fresh clock. Let the visitor re-pick the same card.
- **Plan L:** the station fetches its open session (`mystery-get-session`) and offers it back — same cards, selection and
  synced progress. Whether a run continues or restarts depends on the live frontend; check during rehearsal and note
  it here: ______. An `abandoned` session simply starts a new visitor.
- "Aw, Snap!" page: press **F5**. Laptop rebooted: log in → `serve-dist.cmd` → station launcher.

### 4.6 Network failure

1. **Do not touch the stations.** A run in progress continues; the game runs entirely in the browser.
2. Look at Laptop 1 (connection badge, "Signal lost") and the station HUD ("Offline · saves locally").
3. Check Wi-Fi/captive portal on one laptop; `check-laptop.ps1` Supabase line; <https://status.supabase.com>.
4. Switch all three laptops to the backup hotspot between visitors.
5. Still down after ~10 min: go to **Plan D** between visitors — Alt+F4 the station, relaunch without `-Live`.
   Results are unverified; keep the paper "unofficial" list.
6. When the network is back: relaunch with `-Live` between visitors. Queued live runs resend themselves. Local/unsynced
   results are **never** inserted into the verified board (there is no API for it, and none should be improvised).

### 4.7 Hyde softlock, stuck player, odd bugs

Simulation: all 126 duos finished in bot runs, no softlock found — human play is still untested, so:
1. Stuck on geometry: walk back the way you came, crouch-walk, turn with ← →. **V** asks Thing for a feasible tip.
2. Hyde camping a doorway: hide in a niche until "Losing interest" → "Patrolling"; use F or Q to stun/distract. A chase
   decays a few seconds after it loses sight; it cannot chase forever.
3. Egg dropped: the objective says where ("Your egg was dropped — pick it up (E)"); walk back for it.
4. Nothing helps within ~60 s: Esc → Leave the case, offer a fresh run.
5. Very low frame rate: Home → Display options → **Low graphics** (and Reduced motion); close other apps; check charger.
6. Log every incident: time · station · duo name · what happened · phone photo. **No code changes on event day** —
   only launch flags, resets and Plan D.

### 4.8 Kiosk escapes

- Out of fullscreen / keyboard lock lost: on Home click **Open the case** again (re-arms both). In `--kiosk` the window
  itself stays fullscreen.
- Ctrl+W closed the game: relaunch; tell visitors to crouch with **C**.
- A Windows dialog appeared (Sticky Keys, update, low battery): close it, the game pauses safely; fix the setting after
  the run.
- Alt+Tab / Windows key: the game pauses; click Resume.

### 4.9 Moderation (offensive nickname)

Plan L (owner, SQL Editor):
`select session_id, nickname, station_id, finalized_at from public.mystery_results order by finalized_at desc limit 20;`
then `delete from public.mystery_results where session_id = '<id>';` (results cannot be edited, only removed; every
dashboard updates via Realtime). Plan D: the name is only on that station; start a new run.

### 4.10 End of day — export, then clean up

**Export first.**
- Plan L (owner, Dashboard › SQL Editor; export each result grid as CSV, store outside the repo):
  ```sql
  select * from public.mystery_standings;                                         -- finishers then DNFs
  select * from public.mystery_leaderboard;                                       -- ranked finishers
  select * from public.mystery_results where not is_test order by finalized_at;   -- every verified result
  select * from public.verified_leaderboard;                                      -- legacy v2.5 board, if used
  ```
- Plan D (each station): `start-station-a.cmd -Window` → F12 → Console → `copy(localStorage.getItem('raven.mystery.records'))`
  → paste into Notepad → save `station_a_records_2026-10-27.json` to the USB stick. Same on Laptop 3 and Laptop 1. Each
  browser keeps the newest 200 runs.

**Then clean up.**
1. Plan L: sign the stations out (station header) and afterwards rotate the station passwords
   (SUPABASE_SETUP §5, re-run provisioning) or ban the station users (SUPABASE_SETUP §10).
2. `npx supabase secrets list` — if `MYSTERY_ALLOW_TEST_SEEDS` is there: `npx supabase secrets unset MYSTERY_ALLOW_TEST_SEEDS`.
3. Test rows (`is_test = true`) are never ranked or public — keep them (recommended); deleting is the owner's call:
   `select id, station_id, nickname, created_at from public.mystery_sessions where is_test;`
4. **"LiveTest" (v2.5 board, score 51.88) — owner's decision.** Inspect:
   `select session_id, nickname, final_score, verified_at from public.leaderboard_entries where nickname = 'LiveTest';`
   Delete only on the owner's word: `delete from public.leaderboard_entries where session_id = '<id>';`
5. Only after the export: delete kiosk profiles `%LOCALAPPDATA%\RavenIslandKiosk\*` (removes local records and sign-ins).
6. Laptops: resume Windows Update, restore sleep settings/notifications/Sticky Keys shortcut if the owners want them back.
7. Tag the event build: `git tag event-2026-10-27 <commit>`.

---

## 5. Three-laptop release checklist (master prompt §13 g)

`[x]` = verified with evidence (date · source). `[ ]` = pending. Nothing pending is claimed done.

**Software (dev laptop)**
- [x] Full loop playable through the real keyboard path: 3 clues → egg → tower → accusation → results (bot-driven
      keyboard runs Enid+Gengar, Ajax+Gholdengo, Morticia+Aegislash · 2026-10-21 · PLAYTEST_RESULTS.md).
- [x] All 126 duos finish in simulation, no softlock (bot sim · IMPLEMENTATION_PROGRESS.md).
- [x] 16.7 ms/frame (60 fps cap) at 1366×768 on the dev laptop's Intel UHD, headless (PLAYTEST_RESULTS.md); camera audit
      272 set-ups, 0 obstructed.
- [x] Four analytics render for non-Wednesday duos; risk chip labelled "ML estimate" / rule-based fallback (bot-driven).
- [x] 18/18 Q moves documented with sources (MOVE_LEGALITY.md).
- [x] Mystery backend tests pass offline: pgTAP 83 + 60, unit, 150-session round trip (SUPABASE_SETUP §12.4).
- [x] v2.5 backend deployed and live (legacy routes; "LiveTest" row exists).
- [x] Built bundle and `.env` contain only the anon key for `abkohhdjlufhsbqrchpn` (`check-dist-keys.mjs` · 2026-10-21).
- [x] Kiosk launcher dry-runs for all three roles; laptop checker runs (dev laptop · 2026-10-21).
- [ ] `npm run test:all` + `npm run build` green on the **freeze commit** (commit id: ______).

**Backend / live mode**
- [ ] Owner approval for the mystery-v3.1 deploy (§3 step 1).
- [ ] Mystery migrations + functions deployed and verified (§3 steps 5–8).
- [ ] Live mystery frontend merged (station sign-in, event sync, offline chip, live Laptop 1 feed, reset with scope) and
      the `-Live` station route confirmed in `src/app/routing.ts`.
- [ ] Operator reset tested from Laptop 1 on both stations.
- [ ] Rehearsal rows deleted before doors open.

**Event laptops**
- [ ] Laptop 1 / 2 / 3: `check-laptop.ps1` 0 FAIL; browser versions recorded: L1 ______ L2 ______ L3 ______.
- [ ] Shift ×5, hold right Shift, Ctrl+W tested on both stations — no dialog, tab stays.
- [ ] Event-laptop performance: smooth play at the real resolution on Laptops 2 and 3 (record fps / impressions;
      investigate anything below ~30 fps).
- [ ] **Two stations simultaneously** + Laptop 1 live: no cross-station leakage, both results appear.
- [ ] **≥ 10 human playtests** across duos on the event laptops; record full-visit times (target 5–7 min, no timeout) in
      PLAYTEST_RESULTS.md.
- [ ] Venue network test (HTTPS + Realtime WebSocket) and hotspot fallback tested.
- [ ] 30-minute idle soak: no sleep, dimming, pop-ups.

**Owner / content**
- [ ] Official activity rubric supplied (ACTIVITY_COMPLIANCE.md: unavailable — no compliance claimed).
- [ ] Portrait rights caveat accepted for the event (DECISIONS D-30/D-34).
- [ ] Decision on the v2.5 "LiveTest" entry.
- [ ] Repo backed up off the dev laptop (git push was rejected 403) + USB copy with `dist/` and `node_modules/`.
- [ ] Booth cards printed (×3).

---

## Appendix A — Booth card (print this page)

> ### ESCAPE FROM RAVEN ISLAND — The Silent Evidence
> **“Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.”**
>
> **Goal:** find 3 clues → grab the Pokémon egg → carry it to **Iago Tower** → name who released the Hyde. About 6 minutes.
>
> | Key | Action | Key | Action |
> |---|---|---|---|
> | **W A S D** | Walk | **E** | Search / pick up / deposit egg |
> | **Mouse** or **← → ↑ ↓** | Look | **hold E** | Set the egg down |
> | **Shift** | Sprint — LOUD | **F** | Character power |
> | **C** | Crouch — quiet | **Q** | Pokémon move |
> | **Tab** | Evidence board (pauses) | **V** | Ask Thing for a hint |
> | **Esc** | Pause | **M** | Mute |
>
> **Hyde:** caught once = −35 HP and released; caught twice (or HP 0) = run over (DNF). Hide, crouch, use F/Q to escape.
>
> **Score = egg points × 100 − your active seconds.** Egg: Common 1 · Rare 3 · Legendary 6 points. Pause and the evidence
> board stop the clock. Every finisher ranks above every DNF (negative scores too). Solving the mystery is shown
> separately — it is not part of the score.
>
> **Reset (volunteer):** Esc → *Leave the case* → confirm → Home. Frozen: **F5**. Window gone: double-click the
> station icon. Results: *New investigation* (Enter). Stuck > 1 min or anything odd → tell the operator at Laptop 1
> (time · station · what happened).
>
> Don't tell players who the culprit is. No food or drinks at the keyboards.
