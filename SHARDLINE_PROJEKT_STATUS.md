# SHARDLINE – VOLLSTÄNDIGER PROJEKT- & HANDOFF-STATUS
**Stand:** 11. November 2026  
**Live-Deployment:** https://weblorant.web.app  
**Firebase-Projekt:** `weblorant` (Europe-West1 RTDB: `https://weblorant-default-rtdb.europe-west1.firebasedatabase.app`)  
**Repository-Pfad:** `c:\Users\Anton\Documents\Projekte\Weblorant`

---

## 1. Executive Summary & Zielerreichung
Das Projekt **SHARDLINE** ist ein eigenständiger, rundenbasierter Taktik-Shooter in der Ego-Perspektive für moderne Desktop-Browser (WebGPU mit WebGL 2 Fallback, Rapier 3D Physik, synthetisiertes Web Audio, WebRTC P2P DataChannels mit Firebase Realtime Database Signaling & Relay-Fallback).

### Status der Phasen:
1. **Phase 1 (Offline-Prototyp & Rapier Physik):** ✅ 100% Abgeschlossen (Kinematic Character Motor, Hitscan, Rückstoßmuster, Dummy-Ziele, lokales Match).
2. **Phase 2 (Firebase & Lobby-System):** ✅ 100% Abgeschlossen (Anonymous Auth, Raumcode-Alphabet ohne verwechselbare Zeichen, Presence `.info/connected` + `onDisconnect`, RTDB-Sicherheitsregeln).
3. **Phase 3 (Netcode-Fundament & WebRTC Stern-Netzwerk):** ✅ 100% Abgeschlossen (Dual DataChannels `state` unreliabled/unordered + `events` reliable/ordered, 8s RTDB-Relay-Fallback bei 10 Hz, 30 Hz Host-Autorität, Client-Side Prediction, 100ms Entity-Interpolation).
4. **Phase 4 (Rundenlogik "Kernbruch", Economy "Splitter" & 3-Slot-Loadout):** ✅ 100% Abgeschlossen (25s Kaufphase mit Barrieren, 100s Aktion, 4s Legen, 40s Zünder, 7s Entschärfen mit 50%-Checkpoint, 200ms Lag Compensation mit History-Puffer, 3 Waffen-Slots: Primär, Pistole, Messer).
5. **Phase 5 (4 Spezialisten & 12 Fähigkeiten):** ✅ 100% Abgeschlossen (Ryo Kade, Mira Solen, Brann Okafor, Tessa Vahl – 100% Host-validiert mit Abklingzeiten, Reichweitenkappung & Ult-Punkten).
6. **Phase 6 / Zusatzphase A (Maps-Erweiterung & Prozedurale Architektur):** ✅ 100% Abgeschlossen (4 spielbare Karten: *Hafenwerk*, *Werkstadt*, *Kryowerk*, *Übungsanlage* mit Backstein-Halle & Außenhof-Parcours; 8 neue prozedurale Texturen).
7. **Phase 7 / Zusatzphase B (Komplette UI- & HUD-Überarbeitung nach Screenshot-Vorlage):** ✅ 100% Abgeschlossen (5-Banner-Lobby, Navigation mit Einsatzziele/Spezialisten/Verlauf/Arsenal, Modus-Schublade, 6-Zonen-Kaufmenü mit SVG-Silhouetten, symmetrisches Taktik-HUD).
8. **Phase 8 (Feinschliff, Minimap, Chat, Instancing & Release):** ✅ 100% Abgeschlossen (2D-Canvas-Minimap, Tab-Scoreboard, Enter-Chat mit Team-Isolation & Spam-Schutz, Geometrie-Batching für 60+ FPS, Vendor-Chunk-Splitting in Vite, Live-Deployment auf Firebase).

---

## 2. Rechtliche Vorgaben (STRIKT EINGEHALTEN)
- **Null Fremd-Assets / Null Riot Games IP:** Keinerlei Namen, Charakter-, Waffen- oder Map-Bezeichnungen von Riot Games/Valorant.
- **Keine externen Bild-/Audiodateien:** 100% prozeduraler Code (CanvasTexture, prozedurale SVG-Silhouetten in `src/data/uiIcons.ts`, Web Audio API Synthese in `src/audio/SynthAudio.ts`).
- **Dateien `/*.png` im Wurzelverzeichnis:** Referenz-Screenshots des Nutzers sind in `.gitignore` eingetragen und werden niemals committet oder deployed.

---

## 3. Architektur & Modulübersicht
- **`src/core/`**: `types.ts` (Schnittstellen, Event-Typen, Enums), `Config.ts` (30 Hz Tickrate, Geschwindigkeiten, Rundenzeiten), `math.ts`, `EventBus.ts`, `GameLoop.ts`, `InputManager.ts` (Pointer Lock API).
- **`src/data/`**: `characters.ts` (Spezialisten-Definitionen), `weapons.ts` (Waffenwerte & Rückstoßmuster), `progression.ts` (Einsatzziele, Match-Verlauf, kostenlose Waffen-Finishes), `uiIcons.ts` (prozedurale SVG-Silhouetten), `maps/` (`hafenwerk.ts`, `werkstadt.ts`, `kryowerk.ts`, `uebungsanlage.ts`, `index.ts`).
- **`src/physics/`**: Rapier 3D WASM Integration (`PhysicsWorld.ts`, `CharacterMotor.ts`).
- **`src/game/`** *(100% reine, deterministische Simulation ohne DOM-/Three.js-Imports)*:
  - `HostSimulation.ts`: Autoritative 30 Hz Simulation, Treffervalidierung, Chat-Relay, Kauf-Validierung.
  - `RoundManager.ts`: Runden-Zustandsmaschine (First-to-7, Sudden Death, Seitenwechsel).
  - `Economy.ts`: Splitter-Verwaltung, Sieg-/Niederlagenserien, Kaufzonen-Prüfung.
  - `AbilitySystem.ts`: Deterministiche Fähigkeiten-Logik für alle 4 Spezialisten.
  - `KernLogic.ts`: Aufnahme, Platzierung (Zone A/B) und Entschärfung des Kerns.
  - `WeaponLogic.ts`, `Recoil.ts`, `PlayerHitscan.ts`, `OnlineSession.ts`, `LocalSession.ts`.
- **`src/net/`**: WebRTC Sternnetzwerk (`WebRtcTransport.ts`), Signaling über RTDB (`Signaling.ts`), 8s Fallback-Relay (`RtdbRelayTransport.ts`), `AdaptivePeerTransport.ts`, `Prediction.ts`, `Interpolation.ts`, `LagCompensation.ts` (200ms Rewind), kompaktes Binär-/Tuple-Wire-Protokoll (`Protocol.ts`).
- **`src/render/`**: `Renderer.ts` (WebGPU mit WebGL 2 Fallback), `MapBuilder.ts` (Geometrie-Batching via `mergeGeometries`), `RemotePlayerRenderer.ts`, `AbilityEffectsRenderer.ts`, `ShotEffects.ts`, `DummyRenderer.ts`, `FirstPersonCamera.ts`.
- **`src/ui/`**: `LobbyScreen.ts` (Haupt-Client mit allen Tabs & Modus-Drawer), `BuyMenu.ts` (6-Zonen-Taktik-Kaufmenü `B`), `HudOverlay.ts` (symmetrisches HUD), `Minimap.ts` (2D-Canvas-Minimap), `ScoreboardOverlay.ts` (`Tab`-Scoreboard), `ChatOverlay.ts` (`Enter`-Chat), `DebugOverlay.ts` (`F3`-Telemetrie), `MatchEndOverlay.ts`.

---

## 4. Testabdeckung & Build-Verifikation
- **Unit Tests:** `52 / 52` Tests in `10 / 10` Suites bestanden (`npx vitest run`):
  - `recoil.test.ts`, `weapon.test.ts`, `lobby.test.ts`, `netcode.test.ts`, `economy.test.ts`, `round.test.ts`, `lagcomp.test.ts`, `abilities.test.ts`, `maps.test.ts`, `progression.test.ts`.
- **TypeScript / Build:** `npm run build` (`tsc --noEmit && vite build`) kompiliert fehlerfrei mit `0` Fehlern.
- **Rollup Chunks:** Aufgeteilt in `vendor-three`, `vendor-rapier`, `vendor-firebase` und App-Bundle.

---

## 5. Live-Umgebung & Deployment
- **Hosting URL:** https://weblorant.web.app
- **Firebase Database:** `europe-west1`
- **Deployment-Befehl:** `npx firebase-tools deploy --only database,hosting --project weblorant`

---

## 5b. Update 11.11.2026 – Visiere, Texturen, Matchmaking

### Abgeschlossene Änderungen:
- `src/data/weapons.ts`: neues `scope`-Feld (`none`/`reflex`/`holo`/`sniper`, Zoomstufen, ADS-Streuung). Bolzer & Hornisse: Leuchtpunkt 1,15×, Lanze: Holo 1,25×, Falke: Präzisionsoptik 2,5×/5×.
- `src/game/WeaponLogic.ts`, `LocalSession.ts`: Streuung beim Zielen für alle Visiere (Host & Offline identisch).
- `src/render/FirstPersonCamera.ts`: Visier-Modelle (Reflex, Holo mit Haube, Zielfernrohr mit Turrets), Zoom über echte FOV-Umrechnung, Visierlinie exakt mittig, `getScopeView()`, `cycleZoomLevel()`.
- `src/core/InputManager.ts`: Mausrad / `Z` bei gehaltenem Rechtsklick wechselt Zoomstufe.
- `src/ui/HudOverlay.ts` + `styles.css`: Okular mit Mil-Dots & Zoomanzeige, Leuchtpunkt-/Holo-Absehen.
- `src/render/ProceduralTextures.ts` (neu) + `MapBuilder.ts`: 512er-Texturen mit Rauschen, Abnutzung, Flecken + Normal-Maps; Welt-UVs (kein Strecken mehr auf großen Blöcken).
- `src/net/Matchmaking.ts` (neu, rein): LAN-Erkennung über `netKey`, Host-Wahl mit minimaler Latenz, Auffüllen per Latenz, lokale Gruppen im selben Team, Teil-Teams nach Wartezeit.
- `src/firebase/matchmaking.ts` (neu): Warteschlange `queue/`, Koordinator-Lock `mmLock/`, `matches/`, STUN-basierter gehashter Netzwerk-Schlüssel (IP wird nie gespeichert).
- `src/ui/LobbyScreen.ts`, `src/main.ts`: Button „MATCH FINDEN“, Statuszeile, Auto-Beitritt & Auto-Start.
- `database.rules.json`: Regeln für `queue`, `rttProbe`, `mmLock`, `matches` (**noch nicht deployed**).
- Tests: `npx vitest run` → 62/62 (neu: `tests/matchmaking.test.ts`)
- Build: `npm run build` → fehlerfrei

## 5c. Update 11.11.2026 – Grafikqualität & spannendere Karten

### Abgeschlossene Änderungen:
- `src/core/types.ts`, `Config.ts`: `GameSettings.graphics` (`low` / `high` / `max`), Standard `high`; Auswahl wird in `localStorage` (`shardline.graphicsQuality`) gemerkt.
- `src/ui/HudOverlay.ts` + `styles.css`: Grafik-Selector (NIEDRIG / HOCH / MAX) im Einstellungsdialog, zur Laufzeit umschaltbar.
- `src/render/Renderer.ts`: Qualitätsstufen. NIEDRIG = 0,7× Renderauflösung. MAX = PCF-Soft-Schatten (4096er Map, folgt dem Spieler), Himmel als Umgebungs-Map für Reflexionen, härtere Sonne / weniger Fülllicht. Neuer Himmel mit Wolken und Sonnenscheibe.
- `src/render/MapBuilder.ts`: `setQuality()` (Normal-Maps, Anisotropie, glattere Metalle/Wasser/Eis bei MAX), `update()` (fließendes Wasser, bewegte Deko), Deko-Gruppe bei NIEDRIG ausgeblendet.
- `src/data/maps/detail.ts` (neu, rein visuell, keine Physik): Dächer, Fenster, Mauerleuchten, Container-/Kistendetails, Bodenflecken/Pfützen/Schneewehen, Skyline je Thema, bewegte Kräne/Radar/Windmühlen/Lüfter.
- `src/data/maps/setpieces.ts` (neu, mit Kollision) in Hafenwerk/Werkstadt/Kryowerk: Kistentreppen auf die Plattformen an Zone A & B, Ausguck-Podeste an A-Lang/B-Lang, Fahrzeug-Deckung hinter den Spawn-Barrieren.
- Tests: `npx vitest run` → 64/64 (neu: `tests/mapdetail.test.ts`)
- Build: `npm run build` → fehlerfrei
- Nicht geprüft: WebGL2-Fallback mit MAX, FPS auf echter Hardware. **Noch nicht deployed.**

## 6. Nächste Schritte & Backlog für die Fortsetzung
1. **Offline-Kaufmenü Feinschliff:** Im Offline-Modus öffnet `B` das Kaufmenü, um direkt Waffen/Fähigkeiten auszutauschen (in `main.ts` sicherstellen, dass Pointer Lock Exit nicht ins ESC-Menü abbiegt).
2. **Bot-KI / Erweiterte Dummys:** Ziel-Bots auf den Taktik-Karten patrouillieren lassen.
3. **Turn-Server Konfiguration:** Für strenge symmetrische NAT-Netzwerke optionalen TURN-Server in `src/net/config.ts` eintragen.
