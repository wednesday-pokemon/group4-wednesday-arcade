# Activity compliance

**Original official rubric unavailable; based on existing GDD.** No Pokémon Day III / Analytics Application activity
instructions or grading rubric exist in the repository (searched file names for rubric/activity/instruction/grading/
criteria on 2026-10-21) or in the materials attached to the session. This checklist is built from the documented
constraints in `docs/v3.1/GAME_PLAN_v3_1.md` and the earlier GDD. **Blocker: the team must supply the official rubric** so a
verbatim line-by-line matrix can replace this one. No formal rubric compliance is claimed.

| Documented constraint | Source | Status | Evidence |
|---|---|---|---|
| Exhibition on Oct 27 2026 | plan §1, §12 | in progress | this repo |
| Exactly 3 laptops: Laptop 1 dashboard/operator, laptops 2–3 independent concurrent player stations | plan §1, §10 | built + offline-tested; live deploy + rehearsal pending | live client + station isolation tests; docs/OPERATOR_RUNBOOK.md |
| Four analytics (descriptive, diagnostic, predictive, prescriptive), game-wide for all 126 duos | plan §8 | done (local); live storage pending deploy | src/mystery/analytics/**, 126-duo + 4-duo tests, docs/MYSTERY_MODEL_REPORT.md |
| 5–7-minute full visitor experience, no forced timeout | plan §3 | partly evidenced (bots ~3 min active play + menus); HUMAN playtests pending | docs/PLAYTEST_RESULTS.md |
| Supabase (PostgreSQL + Realtime) and leaderboard, rules_version `mystery-v3.1` | plan §10 | built + tested offline; NOT deployed (owner approval) | supabase/migrations 0005–0008, pgTAP 004–005 |
| 7 Nightshades × 18 Pokémon, three bundled cards per session | plan §4–6 | done | draft/stats tests over 126 pairs; refresh-stable offer |
| Real, form-legal Pokémon move names | plan §6 | done (18/18 verified, sources) | docs/MOVE_LEGALITY.md, src/mystery/data/legality.ts |
