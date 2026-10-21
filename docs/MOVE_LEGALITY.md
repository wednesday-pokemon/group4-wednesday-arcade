# Move Legality Check

## Method

Checked on 2026-10-21. Each of the 18 Pokémon/move pairs in the candidate registry was checked against the learnset for the exact species and form on fetched pages from PokémonDB (`pokemondb.net/pokedex/<name>/moves/<gen>`) and Serebii (`serebii.net/pokedex-sv/`, `pokedex-swsh/`). Most pairs were checked on both sites. Bulbapedia returned HTTP 403 to automated fetches, so it is not cited. Each Pokémon has one declared reference game. That is Scarlet/Violet (Gen IX) when the species or form has a Scarlet/Violet learnset. When PokémonDB lists no Scarlet/Violet moves for it, the declared game is Sword/Shield (Gen VIII), which applies to Alolan Marowak, Galarian Corsola, Jellicent, Aegislash and Dhelmise. Several species also appear in Legends: Z-A (2025), but its real-time battle system differs from the standard one, so it is mentioned only as corroboration and is not the declared game. Nothing is marked verified from memory. Game effects in the arcade are adaptations, not battle mechanics. This file only confirms that each move is a real, legal move for that Pokémon and form. It does not confirm power, accuracy or any battle behavior used in the game.

## Results

| Pokémon | Form | Move | Declared game (generation) | Learn method | Status | Source URL | Notes/replacement rationale |
|---|---|---|---|---|---|---|---|
| Gengar | Standard | Shadow Ball | Scarlet/Violet (Gen IX) | Level-up Lv. 48; TM114 | verified | https://pokemondb.net/pokedex/gengar/moves/9 (also https://www.serebii.net/pokedex-sv/gengar/) | Both sources agree. |
| Marowak | Alolan | Will-O-Wisp | Sword/Shield (Gen VIII) | Level-up Lv. 36 (Alola Form table); TM38 | verified | https://www.serebii.net/pokedex-swsh/marowak/ (also https://pokemondb.net/pokedex/marowak/moves/8) | No Marowak learnset in SV. Alolan Marowak is obtainable in SwSh (Isle of Armor gift and Max Raids). Kantonian Marowak's SwSh level-up list does **not** include Will-O-Wisp, so the move must stay tied to the Alolan form. Corroboration: Legends: Z-A Alolan Marowak TM57. |
| Misdreavus | Standard | Confuse Ray | Scarlet/Violet (Gen IX) | Level-up Lv. 14; TM017 | verified | https://pokemondb.net/pokedex/misdreavus/moves/9 (also https://www.serebii.net/pokedex-sv/misdreavus/) | Both sources agree. |
| Corsola | Galarian | Strength Sap | Sword/Shield (Gen VIII) | Level-up Lv. 35 (Galarian Form table) | verified | https://pokemondb.net/pokedex/corsola/moves/8 (also https://www.serebii.net/pokedex-swsh/corsola/) | Not in SV (PokémonDB lists no SV moves, and Serebii has no SV page). Regular Corsola's SwSh table does **not** list Strength Sap, so the move must stay tied to the Galarian form. |
| Sableye | Standard | Shadow Sneak | Scarlet/Violet (Gen IX) | Level-up Lv. 9 | verified | https://pokemondb.net/pokedex/sableye/moves/9 (also https://www.serebii.net/pokedex-sv/sableye/) | Both sources agree. |
| Dusknoir | Standard | Shadow Punch | Scarlet/Violet (Gen IX) | Level-up Lv. 1 | verified | https://pokemondb.net/pokedex/dusknoir/moves/9 (also https://www.serebii.net/pokedex-sv/dusknoir/) | Serebii lists it in level-up with no level shown ("—"), and PokémonDB gives Lv. 1. Both confirm level-up. |
| Drifblim | Standard | Tailwind | Scarlet/Violet (Gen IX) | Level-up Lv. 48; TM113 | verified | https://pokemondb.net/pokedex/drifblim/moves/9 (also https://www.serebii.net/pokedex-sv/drifblim/) | Both sources agree. |
| Froslass | Standard | Icy Wind | Scarlet/Violet (Gen IX) | TM034 (also level-up; see notes) | verified | https://pokemondb.net/pokedex/froslass/moves/9 (also https://www.serebii.net/pokedex-sv/froslass/) | Both confirm TM034. The level-up level conflicts: PokémonDB says Lv. 30 and Serebii says Lv. 25. Cite TM034, or "level-up" without a number. |
| Jellicent | Standard | Water Pulse | Sword/Shield (Gen VIII) | Level-up Lv. 12 | verified | https://pokemondb.net/pokedex/jellicent/moves/8 | Not in SV (PokémonDB lists no SV moves, and Serebii has no SV page). |
| Chandelure | Standard | Will-O-Wisp | Scarlet/Violet (Gen IX) | Level-up Lv. 1; TM107 | verified | https://pokemondb.net/pokedex/chandelure/moves/9 | Serebii's SV page now shows mostly Legends: Z-A tables, so PokémonDB is the primary source. Z-A corroboration: Lv. 20 / TM057. |
| Aegislash | Standard (Shield/Blade) | King's Shield | Sword/Shield (Gen VIII) | Evolution move (also listed at Lv. 1) | verified | https://pokemondb.net/pokedex/aegislash/moves/8 | Not in SV (PokémonDB lists no SV moves). Signature move. Corroboration: Legends: Z-A evolution move. |
| Trevenant | Standard | Leech Seed | Scarlet/Violet (Gen IX) | Level-up Lv. 1 | verified | https://pokemondb.net/pokedex/trevenant/moves/9 | Not a TM in SV, so cite level-up only. |
| Dhelmise | Standard | Anchor Shot | Sword/Shield (Gen VIII) | Level-up Lv. 52 | verified | https://pokemondb.net/pokedex/dhelmise/moves/8 | Not in SV (PokémonDB lists no SV moves). Signature move. |
| Decidueye | Alolan starter (Grass/Ghost), not Hisuian | Spirit Shackle | Scarlet/Violet (Gen IX) | Evolution move | verified | https://pokemondb.net/pokedex/decidueye/moves/9 (also https://www.serebii.net/pokedex-sv/decidueye/) | Signature move. Both sites keep the two forms in separate tables. Serebii's Hisuian table has Triple Arrows and no Spirit Shackle. Serebii shows Spirit Shackle with no level, which is consistent with an evolution move. |
| Dragapult | Standard | Dragon Darts | Scarlet/Violet (Gen IX) | Evolution move | verified | https://pokemondb.net/pokedex/dragapult/moves/9 | Signature move. Not a TM. |
| Basculegion | Male and Female | Aqua Jet | Scarlet/Violet (Gen IX) | Level-up Lv. 12 (both forms) | verified | https://www.serebii.net/pokedex-sv/basculegion/ (also https://pokemondb.net/pokedex/basculegion/moves/9) | Serebii's separate male and female SV tables both list Aqua Jet at Lv. 12, so either form works. |
| Ceruledge | Standard | Bitter Blade | Scarlet/Violet (Gen IX) | Level-up Lv. 48 | verified | https://pokemondb.net/pokedex/ceruledge/moves/9 | Signature move. |
| Gholdengo | Standard | Make It Rain | Scarlet/Violet (Gen IX) | Level-up Lv. 56 | verified | https://pokemondb.net/pokedex/gholdengo/moves/9 | Signature move. Not a TM. |

**Totals:** 18 verified, 0 replaced, 0 unverified.

## Pairs needing a decision

- **Froslass / Icy Wind:** the sources disagree on the level-up level (PokémonDB says 30, Serebii says 25). We recommend citing TM034, which both sources confirm, or "level-up" without a number. Bulbapedia, which could break the tie, could not be fetched.
- **Five Pokémon declared against Sword/Shield instead of Scarlet/Violet:** Alolan Marowak, Galarian Corsola, Jellicent, Aegislash and Dhelmise have no SV learnset. Confirm that a Gen VIII reference is acceptable. Legends: Z-A is newer and covers some of them, but it uses a different battle system.
- **Form-locked moves:** Will-O-Wisp is legal for **Alolan** Marowak and Strength Sap for **Galarian** Corsola, and the Kantonian/regular forms do not learn these moves the same way. Game art, names and copy must show the regional form.

## Orchestrator rulings (2026-10-21)
- Spot-check: re-fetched pokemondb.net/pokedex/marowak/moves/8 (Alolan Marowak table lists Will-O-Wisp) and
  pokemondb.net/pokedex/gholdengo/moves/9 (Make It Rain) — both confirm the research above.
- **Froslass / Icy Wind:** cite **TM034 (Scarlet/Violet)** as the learn method; the level-up level is not shown in-game.
- **Gen 8 references accepted.** The plan requires "a declared game-generation reference" per species/form, not one
  generation for all. Alolan Marowak, Galarian Corsola, Jellicent, Aegislash and Dhelmise declare Sword/Shield (Gen 8).
- **Regional forms are binding:** names, text and art must say "Alolan Marowak" and "Galarian Corsola" (ids
  `alolan_marowak`, `galarian_corsola`); the regular forms are not used anywhere in the mystery game.
- In-game effects are labelled "Game adaptation of the move …"; they are not battle mechanics.
