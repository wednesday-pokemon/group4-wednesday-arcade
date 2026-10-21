# Three-laptop hardware & network checklist — Escape from Raven Island: The Silent Evidence

Short per-laptop setup for the Oct 27, 2026 booth. The full procedure (build, deploy, event day, booth card, release
checklist) is in [`OPERATOR_RUNBOOK.md`](OPERATOR_RUNBOOK.md). Do this **the day before** (Oct 26) and re-check
the morning of the event. Helper scripts: `scripts/kiosk/` (nothing is installed; they only launch a browser or read
settings).

| Laptop | Role | Opens | Launcher |
|---|---|---|---|
| 1 | Spectator board + operator console | `/?mode=dashboard` (live) · `/?mode=dashboard&demo=1` (LOCAL DEMO) | `scripts\kiosk\start-dashboard.cmd [-Live]` |
| 2 | Player station A (fullscreen kiosk) | `/` (LOCAL DEMO) · live terminal route once deployed (see runbook §2) | `scripts\kiosk\start-station-a.cmd [-Live]` |
| 3 | Player station B (fullscreen kiosk) | same, station B | `scripts\kiosk\start-station-b.cmd [-Live]` |

Label each laptop physically ("1 · DASHBOARD", "2 · STATION A", "3 · STATION B") and its charger.

## 1. Every laptop (Windows 11)

Run the read-only checker first; it prints each item below as PASS / WARN / FAIL with the fix:
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk\check-laptop.ps1`
(on the dev laptop on 2026-10-21 it found: Sticky/Filter Keys shortcuts on, sleep after 10 min, updates not paused —
expect the same on fresh laptops).

1. **Sticky Keys OFF and its shortcut OFF** — Settings › Accessibility › Keyboard › Sticky keys: Off; open it and set
   "Keyboard shortcut for Sticky keys": Off. **Test: press Shift 5×** — nothing may appear. (Sprinting players hammer
   Shift; the dialog steals focus mid-chase.)
2. **Filter Keys OFF and its shortcut OFF** (hold right Shift 8 s); Toggle Keys shortcut OFF (hold NumLock 5 s).
3. **Power**: plugged in; Settings › System › Power › Screen and sleep › *When plugged in*: screen **Never**, sleep
   **Never**; Power mode **Best performance**; lid-close action irrelevant (keep lids open). Battery saver off.
4. **Windows Update**: install pending updates and restart by Oct 25, then **Pause updates** for 1–2 weeks.
5. **Notifications** off or **Do not disturb** on (Settings › System › Notifications). Close/quit chat apps, OneDrive
   pop-ups, antivirus "scan now" prompts; disable startup apps you don't need.
6. **Display**: Scale **100 %**; native resolution; refresh rate **60 Hz** (Settings › Display › Advanced display) —
   the game was measured at a 60 Hz cap; 120/144 Hz makes the GPU draw twice as often. Brightness 80–100 %.
   If scaling cannot be 100 %, launch with `-ForceScale1`.
7. **Graphics**: Settings › System › Display › Graphics › add Chrome (or Edge) › **High performance**. Then open
   `chrome://gpu` once: "WebGL: Hardware accelerated".
8. **Mouse** (stations): wired or fresh-battery mouse; Control Panel › Mouse › Pointer Options: **untick "Enhance pointer
   precision"**, speed at the middle notch. In-game look sensitivity (Esc › Settings) default 5 — set once per visitor
   only if asked.
9. **Keyboard** (stations): full-size external keyboard recommended (WASD + Shift + C + Ctrl easy to reach); disable the
   touchpad while playing if palms trigger it (Settings › Bluetooth & devices › Touchpad: Off — re-enable after).
10. **Sound**: Windows volume ~60 %, game sound on (M toggles mute). Headphones optional for players; captions are always
    on. Laptop 1 can stay muted.
11. **Browser**: Chrome (or Edge) current stable, **≥ 120** (dev laptop: Chrome 155.0.8059.85, Edge 155.0.4283.62).
    Record each laptop's version in the release checklist. Do **not** update the browser on event day.
12. **Clock**: Settings › Time › Set time automatically: On (results/dashboards show times).
13. **Account**: a local Windows account without a password prompt on wake is easiest; never leave the Supabase
    dashboard or a password manager open on a station.

## 2. Network

1. **Internet is required only for live (verified) mode** — Supabase project `abkohhdjlufhsbqrchpn`
   (ap-northeast-1, `https://abkohhdjlufhsbqrchpn.supabase.co`). LOCAL DEMO needs no internet once the game is served.
2. Test at the **actual venue** the day before: join the venue Wi-Fi on all three laptops; finish any captive-portal
   login; run `check-laptop.ps1` (Supabase :443 must be PASS); open the live dashboard and confirm its Realtime/
   connection badge reads Connected (WebSockets can be blocked by school filters even when HTTPS works).
3. **Backup uplink**: a phone hotspot with enough data, pre-joined on all three laptops ("connect automatically" off so
   they don't hop networks by themselves). Charge the phone; bring its cable.
4. **School Wi-Fi often blocks laptop-to-laptop traffic** (client isolation). Therefore serve the game **locally on each
   laptop** (runbook §1, option A). Only use Laptop 1 as a LAN server (option C) if you have verified the stations can
   load `http://<laptop-1-ip>:4173` at the venue; then also allow Node.js through Windows Firewall on *Private*
   networks and set the Wi-Fi profile to *Private*.
5. Keep Ethernet adapters/dongles in the kit if the venue offers wired ports.

## 3. Physical booth kit

- 3 laptops + 3 chargers + 1 power strip (6 outlets) + extension cord; tape for cables.
- 2 external keyboards + 2 wired mice + mouse pads for stations; spare batteries if wireless.
- USB stick with: the repo folder at the freeze commit **including `dist/` and `node_modules/`** (so
  `serve-dist.cmd` works without internet) and the Node.js LTS installer; no `.env` secrets beyond the two browser-safe
  values (runbook §1.3).
- 3 printed booth cards (runbook Appendix A), 1 printed copy of runbook §4 (event-day operation).
- Paper + pen for the fallback "unofficial scores" list and for the issue log (time · station · what happened).
- Phone hotspot (charged), optional headphones with disinfectant wipes.

## 4. Station test run (each station, after setup)

1. Start the server (`scripts\kiosk\serve-dist.cmd`) or confirm the hosted URL loads.
2. Double-click `start-station-a.cmd` / `start-station-b.cmd` → the Home page fills the screen, no browser UI.
3. Click **Open the case** → enter a test name → pick a card → play the tutorial: W A S D moves, mouse looks, **C**
   crouches, **E** searches the crate, **F**/**Q** fire, **Shift** sprints, Tab opens the board, V asks Thing, **Esc**
   pauses (pointer released) and a click resumes, M mutes.
4. Press **Shift 5×** and **hold right Shift 9 s** — no Windows dialog. Press **Ctrl+W** in-game — the tab must not close
   (if it does, keyboard lock is not active: C still crouches; see runbook §4.8).
5. Play to the end once (≈ 3–4 min of play): 3 clues → egg → Iago Tower → accuse → results. Note the frame rate
   impression (smooth / stutters) and any warnings.
6. Laptop 1: open the dashboard; in live mode check that both stations' cards update (phase, clues) and that
   "Signal lost" disappears within 15 s of a station starting.
7. Leave everything running for 30 min to confirm nothing sleeps, dims or pops up.
