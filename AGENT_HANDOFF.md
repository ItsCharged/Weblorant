# SHARDLINE – AGENT HANDOFF & RESUMPTION PROTOCOL
**Zur Übergabe an die nächste KI-Instanz bzw. zur Wiederaufnahme**

---

## An den übernehmenden KI-Agenten:
Du übernimmst das Projekt **SHARDLINE**, einen vollständigen 3D-Browser-Taktik-Shooter.
Der Stand ist vollständig funktionsfähig, gebaut, getestet und live auf Firebase deployed.

### 1. Wichtigste Regeln & Constraints:
- **KEINE URHEBERRECHTSVERLETZUNGEN:** Niemals Namen, Begriffe oder Logos von Riot Games / Valorant einfügen. Alles bleibt bei den SHARDLINE-Originalbegriffen (*Kern*, *Splitter*, *Funke*, *Bolzer*, *Hornisse*, *Brecher*, *Lanze*, *Falke*, *Ryo Kade*, *Mira Solen*, *Brann Okafor*, *Tessa Vahl*, *Hafenwerk*, *Werkstadt*, *Kryowerk*, *Übungsanlage*).
- **KEINE EXTERNEN ASSETS:** Keine Bild- oder Sounddateien herunterladen oder importieren. Alles wird prozedural per Code (SVG, Canvas, Web Audio API) generiert.
- **DETERMINISTISCHE GAME-LOGIK:** Der Ordner `src/game/` darf **niemals** `three`, `Renderer` oder DOM-Elemente importieren.
- **GITIGNORE BEACHTEN:** Keine `*.png` oder `.env*` committen.

---

## 2. Projekt starten & testen:
```bash
# Dependencies installieren
npm install

# Unit-Tests ausführen (12 Suites, 64 Tests)
npx vitest run

# Typecheck & Produktions-Build
npm run build

# Lokalen Dev-Server starten
npm run dev -- --port 5173

# Live auf Firebase ausrollen (bereits eingerichtet mit weblorant)
npx firebase-tools deploy --only database,hosting --project weblorant
```

---

## 2b. Stand der letzten Sitzung (11.11.2026, live auf https://weblorant.web.app)
Details mit Dateiliste stehen in `SHARDLINE_PROJEKT_STATUS.md`, Abschnitte 5b und 5c. Kurzfassung:

- **Visiere:** `WeaponStats.scope` (`none` / `reflex` / `holo` / `sniper`) in `src/data/weapons.ts`. Rechtsklick zielt, Mausrad oder `Z` wechselt die Zoomstufe. Streuung über `computeEffectiveWeaponSpreadDeg` (Host und Offline identisch).
- **Texturen:** `src/render/ProceduralTextures.ts` (Albedo + Normal-Map, 512 px). `MapBuilder.applyWorldUVs` kachelt in Metern statt pro Fläche.
- **Matchmaking:** reine Logik in `src/net/Matchmaking.ts`, Firebase-Anbindung in `src/firebase/matchmaking.ts`, Button „MATCH FINDEN“ in der Lobby. RTDB-Pfade: `queue/`, `rttProbe/`, `mmLock/`, `matches/` (Regeln sind deployed).
- **Grafikqualität:** `GameSettings.graphics` (`low` / `high` / `max`), Selector im Einstellungsdialog, gespeichert unter `localStorage['shardline.graphicsQuality']`. Umsetzung in `Renderer.setQuality` und `MapBuilder.setQuality`.
- **Karten:** `src/data/maps/setpieces.ts` = Spielelemente **mit** Kollision (Kistentreppen, Ausguck-Podeste, Fahrzeug-Deckung). `src/data/maps/detail.ts` = reine Deko **ohne** Physik, wird nur vom `MapBuilder` benutzt.

### Nicht verifiziert – bitte zuerst prüfen
1. **Matchmaking mit mehreren Geräten:** Zuweisung, Auto-Beitritt, Auto-Start und LAN-Erkennung sind nur per Unit-Test und Einzel-Client geprüft. Test: zwei Geräte im selben WLAN plus eines übers Mobilnetz.
2. **FPS bei MAX** auf echter Hardware (die eingebettete Vorschau zeigte nur 4 FPS, auch vor den Änderungen). Stellschrauben: `shadow.mapSize` und `SHADOW_HALF_EXTENT` in `src/render/Renderer.ts`.
3. **WebGL2-Fallback mit MAX:** getestet wurde nur WebGPU.
4. **Zielen im Spiel** (Visier-Ausrichtung, Zoomstufen) und **Kistentreppen/Podeste** wurden nicht von Hand gespielt, nur rechnerisch geprüft (`tests/mapdetail.test.ts`).
5. **Git:** Das Repo hat noch keinen einzigen Commit.

### Bewusste Entscheidungen
- **Menüs nicht 1:1 nach den Referenz-Screenshots:** Die Screenshots zeigen Valorant; eine Kopie des Looks widerspricht Regel 1 oben. Der Nutzer wollte die Menüs näher an den Bildern – möglich ist nur ein eigener Aufbau im SHARDLINE-Stil.
- **Keine eigenen Shader:** Schatten, Reflexionen und Licht nutzen die eingebauten three.js-Materialien, weil das Spiel auf WebGPU **und** WebGL2 läuft und eigener Shader-Code doppelt gepflegt werden müsste.
- **Latenz im Matchmaking ist geschätzt** (Server-RTT + Zeitzone), nicht zwischen Spielern gemessen. Spieler hinter demselben NAT gelten als „lokal“.

---

## 3. Offene Punkte / Was du als Nächstes tun kannst:
1. **Offline-Kaufmenü (Taste `B`):**
   - In `src/main.ts` ist das Kaufmenü (`#buy-menu-overlay`) für den Online-Modus perfekt integriert.
   - Stelle sicher, dass beim Drücken von `B` im Trainingsmodus (`localSession`) direkt das `#buy-menu-overlay` aufgeht und Klicks auf Waffen diese sofort im Spiel ausrüsten, ohne dass das Pause-Menü dazwischenfunkt.
2. **Minimap-Feinschliff:**
   - In `src/ui/Minimap.ts` können noch dynamischere Sichtkegel oder Ping-Marker für Teammitglieder ergänzt werden.
3. **Erweiterte Audio-Synthese:**
   - In `src/audio/SynthAudio.ts` können weitere räumliche Hall- und Waffensound-Nuancen hinzugefügt werden.

---

## 4. Rückübergabe (Handoff zurück zum ursprünglichen Agenten):
Wenn du deine Arbeiten abgeschlossen hast, erstelle eine Zusammenfassung in diesem Format und aktualisiere `SHARDLINE_PROJEKT_STATUS.md`:
```markdown
### Abgeschlossene Änderungen:
- [Datei]: [Was geändert wurde]
- Tests: [Status npx vitest run]
- Build: [Status npm run build]
```
Danach kann der ursprüngliche Agent nahtlos an den Code anknüpfen!
