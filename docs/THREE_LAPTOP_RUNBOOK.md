# Three-laptop hardware & network checklist — Nevermore: Deadly Secrets (rules `mystery-v3.1`, overhaul 2026-10-23)

Short per-laptop setup for the **Tue Oct 27, 2026** booth. The full procedure (build, Plan L / Plan D, deploy order,
event day, booth card) is in [`OPERATOR_RUNBOOK.md`](OPERATOR_RUNBOOK.md); the GO / NO-GO list with evidence is
[`overhaul/DEPLOY_READINESS.md`](overhaul/DEPLOY_READINESS.md). Do this **the day before** (Oct 26) and re-check the
morning of the event. Helper scripts: `scripts/kiosk/` (nothing is installed; they only launch a browser or read
settings).

| Laptop | Role | Plan D (LOCAL DEMO, no internet) | Plan L (live, after the owner-run deploy) | Launcher |
|---|---|---|---|---|
| 1 | Spectator board + operator console | `/?mode=dashboard&demo=1` | `/?mode=dashboard` | `scripts\kiosk\start-dashboard.cmd [-Live]` |
| 2 | Player station A (fullscreen kiosk) | `/` | `/?mode=terminal&station=station_a` | `scripts\kiosk\start-station-a.cmd [-Live]` |
| 3 | Player station B (fullscreen kiosk) | `/` | `/?mode=terminal&station=station_b` | `scripts\kiosk\start-station-b.cmd [-Live]` |

Label each laptop physically ("1 · DASHBOARD", "2 · STATION A", "3 · STATION B") and its charger.

## 1. Every laptop (Windows 11)

Run the read-only checker first; it prints each item below as PASS / WARN / FAIL with the fix:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk\check-laptop.ps1                 :: Plan L (also tests Supabase :443)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk\check-laptop.ps1 -SkipSupabase   :: Plan D (contacts nothing online)
```

Target: **0 FAIL**, and every WARN either fixed or consciously accepted. On the dev laptop (2026-10-24) it reported 3 FAIL
(Sticky Keys shortcut, Filter Keys shortcut, sleep after 10 min) and WARNs for 144 Hz, two GPUs, mouse acceleration,
notifications, updates not paused, screen off after 5 min — expect the same on fresh laptops.

1. **Sticky Keys OFF and its shortcut OFF** — Settings › Accessibility › Keyboard › Sticky keys: Off; open it and set
   "Keyboard shortcut for Sticky keys": Off. **Test: press Shift 5×** — nothing may appear. (Sprinting players hammer
   Shift; the dialog steals focus mid-chase.)
2. **Filter Keys OFF and its shortcut OFF** (hold right Shift 8 s); Toggle Keys shortcut OFF (hold NumLock 5 s).
3. **Power**: plugged in; Settings › System › Power › Screen and sleep › *When plugged in*: screen **Never**, sleep
   **Never**; Power mode **Best performance**; keep lids open. Battery saver off.
4. **Windows Update**: install pending updates and restart by Oct 25, then **Pause updates** for 1–2 weeks.
5. **Notifications** off or **Do not disturb** on. Quit chat apps, OneDrive pop-ups, antivirus "scan now" prompts.
6. **Display**: Scale **100 %**; native resolution; refresh rate **60 Hz** (Settings › Display › Advanced display) —
   the game is capped and measured at 60 fps; a 120/144 Hz panel makes the compositor and HUD redraw twice as often for
   nothing (the checker WARNs above 60 Hz). Brightness 80–100 %. If scaling cannot be 100 %, launch with `-ForceScale1`.
7. **Graphics**: Settings › System › Display › Graphics › add Chrome (or Edge) › **High performance**. Laptops with two
   GPUs (the checker lists them) otherwise run the game on the integrated GPU. Open `chrome://gpu` once: "WebGL:
   Hardware accelerated".
8. **Browser zoom 100 %**: the kiosk profiles start at 100 %. A visitor pressing Ctrl+wheel / Ctrl+= would change it for
   that profile (the checker reads each kiosk profile and WARNs). Fix: `start-station-a.cmd -Window` → Ctrl+0 → close.
9. **Mouse** (stations): wired or fresh-battery mouse; Control Panel › Mouse › Pointer Options: **untick "Enhance
   pointer precision"**, middle speed notch. In-game look sensitivity (Esc › Settings) default 5; it resets per visitor.
10. **Keyboard** (stations): full-size external keyboard recommended (W A S D, Shift, C, E, Q, R, Tab, V within reach);
    disable the touchpad while playing if palms trigger it (Settings › Bluetooth & devices › Touchpad: Off).
11. **Sound**: Windows volume ~60 %, game sound on (M toggles mute; M is listed only in Pause › Controls). The game
    uses audio cues (Hyde footsteps, a shimmer near hidden evidence) — headphones help in a loud hall; captions are
    always on. Laptop 1 can stay muted.
12. **Fullscreen**: stations open in `--kiosk` (no browser UI; Alt+F4 exits). The first click on **Open the case**
    also requests element fullscreen + keyboard lock (Ctrl then crouches too, Ctrl+W/Esc stay in the game). The
    dashboard opens as a fullscreen app window (F11 toggles).
13. **Browser**: Chrome (or Edge) current stable, **≥ 120** (dev laptop 2026-10-24: Chrome 155.0.8059.86, Edge
    155.0.4283.62). Record each laptop's version in DEPLOY_READINESS. Do **not** update the browser on event day.
14. **Clock**: Settings › Time › Set time automatically: On (results/dashboards show times).
15. **Account**: a local Windows account without a password prompt on wake is easiest; never leave the Supabase
    dashboard or a password manager open on a station.

## 2. Network

1. **Plan D (LOCAL DEMO) needs no internet at all** once the game is served locally — verified 2026-10-24 with every
   non-localhost request blocked (DEPLOY_READINESS §2). Fonts, the Draco decoder, artwork, audio and 17 of 18 Pokémon
   3D models are inside `dist/`; Galarian Corsola always shows its artwork (no working upstream model, DECISIONS D-37).
2. **Plan L (live, verified) needs internet** — Supabase project `abkohhdjlufhsbqrchpn` (ap-northeast-1,
   `https://abkohhdjlufhsbqrchpn.supabase.co`), HTTPS **and** the Realtime WebSocket (`wss://…/realtime/v1/websocket`).
3. Test at the **actual venue** the day before: join the venue Wi-Fi on all three laptops; finish any captive-portal
   login; run `check-laptop.ps1` (Supabase :443 must be PASS); open the live dashboard and confirm its connection
   badge reads Connected (school filters often block WebSockets even when HTTPS works).
4. **Backup uplink**: a phone hotspot with enough data, pre-joined on all three laptops ("connect automatically" off).
5. **School Wi-Fi often blocks laptop-to-laptop traffic** (client isolation). Serve the game **locally on each laptop**
   (runbook §1.3 option A). Use Laptop 1 as a LAN server only if verified at the venue (Windows Firewall: allow Node.js on
   *Private* networks; Wi-Fi profile *Private*).
6. **Plan D limitation (important):** every laptop's browser keeps its own LOCAL DEMO data (`localStorage` in its kiosk
   profile). Laptop 1's board can never see what stations 2 and 3 played — not even on the same Wi-Fi or the same
   server, because browser storage never leaves the machine. Rehearsal 2026-10-24: board in its own profile = 0 runs
   while both stations finished 3 runs each.

## 3. Physical booth kit

- 3 laptops + 3 chargers + 1 power strip (6 outlets) + extension cord; tape for cables.
- 2 external keyboards + 2 wired mice + mouse pads for stations; spare batteries if wireless. Optional 2 headphones +
  disinfectant wipes.
- USB stick with: the repo folder at the freeze commit **including `dist/` and `node_modules/`** (so `serve-dist.cmd`
  works without internet) and the Node.js LTS installer; the `.env` holds only the two browser-safe values.
- 3 printed booth cards (runbook Appendix A), 1 printed copy of runbook §4 (event-day operation).
- Paper + pen for the "unofficial scores" list (Plan D) and the issue log (time · station · duo · what happened).
- Phone hotspot (charged) + cable.

## 4. Station test run (each station, after setup)

1. Start the server (`scripts\kiosk\serve-dist.cmd`, window stays open) — `check-laptop.ps1` "Game URL" PASS.
2. Double-click `start-station-a.cmd` / `start-station-b.cmd` (add `-Live` in Plan L) → Home fills the screen, no
   browser UI. Plan L: sign in with this station's account (owner types the password).
3. **Open the case** → test name `TEST` → pick a card → case file → Skip intro → tutorial (3 short steps, Skip = Enter).
   Check every key: **W A S D** move, mouse / arrow keys look, **Shift** sprint (noise meter goes LOUD), **C** crouch
   (Ctrl too once the keyboard lock is on), **E** search (hold), **Q** character power, **R** Pokémon move (F also fires
   the power — hidden alias), **Tab** opens the Investigation overlay (evidence + map, clock paused; Tab/Esc closes),
   **V** asks Thing for a hint, **Esc** pauses (pointer released) and a click resumes, **M** mutes.
4. Press **Shift 5×** and **hold right Shift 9 s** — no Windows dialog. Press **Ctrl+W** in-game — the tab must not close
   (if it does, keyboard lock is not active; C still crouches; runbook §4.9).
5. Play to the end once (bots: 2–4 min of play; a first-time human about 3–5 min): 3 clues → egg → Iago Tower → name
   the culprit → results. Note the frame-rate impression (smooth / stutters); if it stutters, Home › Display options ›
   **Low graphics** and re-test (runbook §4.8).
6. Laptop 1: Plan L — both station cards update (phase, clues) and "Signal lost" clears within 15 s of a station
   starting. Plan D — the board shows only its own browser (expected; §2.6).
7. Leave everything running for 30 min to confirm nothing sleeps, dims or pops up.
8. Plan D: clear the rehearsal data before doors open (runbook §2, step 5).
