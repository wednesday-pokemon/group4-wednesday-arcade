# Frontend carry-over items (from the overhaul deployment-engineer, 2026-10-24) — fold into the enemy HUD wave

- P2: low graphics should also cut CPU work; `src/ui/mystery/map/mapRender.ts` and `src/ui/mystery/hud/Compass.tsx` call
  `measureText` on fixed labels every frame — cache the widths.
- P3: live board — in `src/app/mystery/liveDashboard.tsx` + `src/ui/styles/dashboard.css` the "Hyde chases / run" tile sits
  under the "Live · verified" badge (63×28 px at 1366).
- P4: `src/ui/mystery/MysteryDashboard.tsx:451` says "Every finished case was solved." with 0 runs.
- P5: `src/ui/mystery/stationView.ts` shows "Idle" for both stations while the board is offline (it cannot know).
- Perf: measure the real app at 1× and 4× CPU throttle (`output/deploy-perf.mjs`) before/after the second enemy.
