# Project: SHARDLINE (`Weblorant`) Visual, UI, Texture, Keybind & Map Overhaul

## Architecture
- **Core & Input Layer (`src/core/types.ts`, `src/core/Config.ts`, `src/core/InputManager.ts`, `src/main.ts`)**:
  - Typed `KeybindSettings` & `DEFAULT_KEYBINDS` persisted in `localStorage` under `shardline.settings` / `shardline.keybinds`.
  - Conflict-free default bindings, keybind conflict detector (`findKeybindConflicts`), human-readable key code formatter (`formatKeyCodeLabel`), and strict Pointer Lock / modal gating so keys (`B`, `1`–`4`, `E`) never double-fire or leak into open dialogs.
- **UI & Menu Layer (`public/assets/menu-portal-bg.png`, `src/ui/styles.css`, `src/ui/LobbyScreen.ts`, `src/ui/HudOverlay.ts`, `src/ui/BuyMenu.ts`, `src/ui/Minimap.ts`)**:
  - Nano Banana (`generate_image`) dark shattered portal background (`public/assets/menu-portal-bg.png`) rendered behind `.shard-lobby-overlay` with dark vignette contrast.
  - Minimal, solid/opaque tactical shooter UI (`#090c12`, `#10151f`, `#161d2a` without excessive transparency/blur), bold pure-white (`#ffffff`) uppercase typography, high-contrast section headers, and clean multi-menu/sub-menu navigation in both `LobbyScreen` (`SPIELEN` sub-menus: `EINSATZ & SPIELMODUS`, `RAUM & TRUPP`, `TRAINING & SCHIESSSTAND`) and `HudOverlay` (`#pause-dialog` split into 5 dedicated sub-menu tabs: `EINSATZ`, `GRAFIK & AUDIO`, `FADENKREUZ`, `STEUERUNG & TASTEN`, `NETZWERK`, including an interactive Keybind Remapper & Conflict Detector).
- **Textures, Materials & Rendering Layer (`src/render/ProceduralTextures.ts`, `src/render/MapBuilder.ts`, `src/render/Renderer.ts`)**:
  - Multi-scale, toroidally wrapped procedural textures (`ox, oy ∈ {-size, 0, size}`) with `roughnessMap`, multi-hue brick/stone/timber/concrete/plaster/asphalt/arctic surfaces, and complete removal of repetitive high-contrast stamp landmarks (air vents, tie-rod holes, non-wrapping rain streaks, vertical iron straps, fake window frames).
  - Subdivided box geometry in `MapBuilder` with WebGPU/WebGL2-compatible vertex-color macro-variation (8 m–25 m world-space tonal modulation + vertical ground-contact ambient occlusion / weathering gradient + per-block slight tonal variation) and rotation-aware world UVs.
  - Enhanced directional vs. fill lighting contrast and sky reflection environment map (`env: 0.35`) on `'high'` quality in `Renderer.ts`.
- **Map Population & Architectural Detail Layer (`src/data/maps/detail.ts`, `src/data/maps/setpieces.ts`, `src/data/maps/hafenwerk.ts`, `src/data/maps/werkstadt.ts`, `src/data/maps/kryowerk.ts`, `src/data/maps/uebungsanlage.ts`)**:
  - Architectural wall segmentation in `detail.ts`: continuous base plinths (`Sockelleisten`), periodic structural pilasters/columns (`Wandpfeiler` every 8–10 m), horizontal mid-wall belt courses/friezes (`Gesims`), doorway/corridor overhead lintels & archways, industrial conduits/pipes, tactical site callout signage (`STANDORT A`, `STANDORT B`, `MITTE`), and rich interior/courtyard environmental props (stacked pallets, radianite/shard canisters, barrier bollards, overhead gantries/catwalks, control consoles, floodlight towers).
  - Removal of weird 3 cm raised `water_dock`/`ice_glass` floor boxes, `concrete`-textured trees/mountains, and misapplied `'terracotta'` roof tiles on walkable ramps.

## Feature Inventory
Every feature from the Survey phase must appear here with its assigned milestone. No feature may be left unassigned.
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Conflict-Free Default Keybinds | Decouple `KeyE` (Ability E) from `holdKern` (`Digit4`/`KeyF`), decouple `Digit4` from offline weapon 4, make `Digit3` equip Knife in both online & offline modes, remove hidden duplicate `KeyC` crouch binding, and gate `KeyB`/`Digit1`–`Digit4` when dialogs are open. | M1 | survey (`explorer_survey_1`) |
| 2 | Configurable Keybinds & Conflict Detection | Add `KeybindSettings` to `GameSettings` (`types.ts`, `Config.ts`), persist to `localStorage`, implement `findKeybindConflicts` and `formatKeyCodeLabel`, and allow interactive keybind remapping & reset in Settings. | M1 | survey (`explorer_survey_1`) |
| 3 | Offline Map Cycling (`KeyM`) & Minimap DPR Resize | Update `KeyM` in `src/main.ts` to cycle all 4 maps (`hafenwerk`, `werkstadt`, `kryowerk`, `uebungsanlage`) and update `Minimap` on window resize. | M1 | survey (`explorer_survey_3`) |
| 4 | Dark Shattered Portal Background (Nano Banana) | Generate a dark shattered portal background (`gebrochenes portal aber so in richtig dunkel`) via Nano Banana (`generate_image`), save to `public/assets/menu-portal-bg.png`, and integrate into `.shard-lobby-overlay`. | M1 | survey (`explorer_survey_1`) |
| 5 | Minimal, Opaque UI & Bold White Typography | Overhaul `src/ui/styles.css` to replace translucent glassmorphic panels with solid/opaque dark tactical panels, crisp borders, and bold pure-white (`#ffffff`) uppercase typography with prominent section titles across all menus. | M1 | survey (`explorer_survey_1`) |
| 6 | Multi-Menu / Sub-Menu Architecture (`LobbyScreen` & `HudOverlay`) | Split the cluttered `SPIELEN` sidebar in `LobbyScreen.ts` into structured sub-menus/views with clear section headers, and split the monolithic `#pause-dialog` in `HudOverlay.ts` into 5 clean sub-menu tabs (`EINSATZ`, `GRAFIK & AUDIO`, `FADENKREUZ`, `STEUERUNG & TASTEN`, `NETZWERK`). | M1 | survey (`explorer_survey_1`) |
| 7 | Non-Repeating, Multi-Hue Procedural Textures & `roughnessMap` | Redesign `ProceduralTextures.ts` with toroidal wrapping on all primitives, larger tile scales, `roughnessMap`, dedicated plaster & asphalt surfaces, multi-hue brick/stone/timber/concrete, and removal of periodic stamp landmarks (vents, tie-rod holes, iron straps, non-wrapping rain streaks). | M2 | survey (`explorer_survey_2`) |
| 8 | Wall Macro-Variation, Ground AO Gradient & UV Fixes | Subdivide box geometries in `MapBuilder.ts` and apply WebGPU/WebGL2-compatible vertex-color macro-variation + ground-contact AO gradient + rotation-correct world UVs; tune `Renderer.ts` `'high'` quality lighting contrast & IBL reflections. | M2 | survey (`explorer_survey_2`) |
| 9 | Architectural Wall Segmentation & Map Prop Enrichment | Enrich `detail.ts`, `setpieces.ts`, and map definitions (`hafenwerk`, `werkstadt`, `kryowerk`, `uebungsanlage`) with structural wall pilasters, base plinths, belt courses, overhead beams/arches, industrial conduits, radianite/shard crates, tactical cover & callout details; fix 3 cm floor boxes, concrete trees/peaks, and terracotta ramps. | M2 | survey (`explorer_survey_2`, `explorer_survey_3`) |
| 10 | Comprehensive Automated Test Suite & Integrity Verification | Unit & integration tests covering keybind conflict detection, non-overlapping default keybinds, procedural textures, map detail density & collider safety, plus full build & E2E verification. | M1, M2 | survey (`explorer_survey_1`, `explorer_survey_2`, `explorer_survey_3`) |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Keybinds, Dark Portal Background, & Minimal Opaque Multi-Menu UI Overhaul | Features 1, 2, 3, 4, 5, 6, 10 (Part 1) — `public/assets/menu-portal-bg.png`, `src/core/types.ts`, `src/core/Config.ts`, `src/core/InputManager.ts`, `src/main.ts`, `src/ui/styles.css`, `src/ui/LobbyScreen.ts`, `src/ui/HudOverlay.ts`, `src/ui/BuyMenu.ts`, `src/ui/Minimap.ts`, `tests/keybinds.test.ts` | none | IN_PROGRESS |
| 2 | M2: Procedural Textures, Wall Anti-Tiling Macro-Shading, & Rich Map Population | Features 7, 8, 9, 10 (Part 2) — `src/render/ProceduralTextures.ts`, `src/render/MapBuilder.ts`, `src/render/Renderer.ts`, `src/data/maps/detail.ts`, `src/data/maps/setpieces.ts`, `src/data/maps/hafenwerk.ts`, `src/data/maps/werkstadt.ts`, `src/data/maps/kryowerk.ts`, `src/data/maps/uebungsanlage.ts`, `tests/maps.test.ts`, `tests/mapdetail.test.ts` | none | IN_PROGRESS |

## Interface Contracts
### `src/core/types.ts` & `src/core/Config.ts` ↔ `src/core/InputManager.ts` & `src/ui/HudOverlay.ts`
- `KeybindAction`: `'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'jump' | 'walk' | 'crouch' | 'reload' | 'slot1' | 'slot2' | 'slot3' | 'kernInteract' | 'abilityQ' | 'abilityE' | 'abilityUlt' | 'zoomCycle' | 'buyMenu' | 'scoreboard' | 'abilityInfo' | 'specialistSelect' | 'debugOverlay' | 'mapSwitchOffline'`
- `KeybindMap = Record<KeybindAction, string>`
- `GameSettings.keybinds: KeybindMap` (merged with `DEFAULT_KEYBINDS` on load so partial saved settings never break).
- `findKeybindConflicts(keybinds: KeybindMap): Array<{ code: string; actions: KeybindAction[] }>`

### `src/render/ProceduralTextures.ts` ↔ `src/render/MapBuilder.ts`
- `SurfaceTexture`: `{ map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; tileMeters: number }`
- `MapBuilder.getBlockMaterial(material, color)` attaches `map`, `normalMap`, `roughnessMap`, and `vertexColors: true`.

## Code Layout
- **M1 Exclusive Write Ownership**:
  - `public/assets/menu-portal-bg.png`
  - `src/core/types.ts`, `src/core/Config.ts`, `src/core/InputManager.ts`, `src/main.ts`
  - `src/ui/styles.css`, `src/ui/LobbyScreen.ts`, `src/ui/HudOverlay.ts`, `src/ui/BuyMenu.ts`, `src/ui/Minimap.ts`, `src/ui/MatchEndOverlay.ts`, `src/ui/ScoreboardOverlay.ts`
  - `tests/keybinds.test.ts`
- **M2 Exclusive Write Ownership**:
  - `src/render/ProceduralTextures.ts`, `src/render/MapBuilder.ts`, `src/render/Renderer.ts`
  - `src/data/maps/detail.ts`, `src/data/maps/setpieces.ts`, `src/data/maps/hafenwerk.ts`, `src/data/maps/werkstadt.ts`, `src/data/maps/kryowerk.ts`, `src/data/maps/uebungsanlage.ts`
  - `tests/maps.test.ts`, `tests/mapdetail.test.ts`
