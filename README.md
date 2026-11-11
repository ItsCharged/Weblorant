# SHARDLINE

**SHARDLINE** ist ein kompetitiver, taktischer First-Person-Shooter direkt im Browser — entwickelt in **TypeScript**, **Three.js**, **Rapier 3D**, **WebRTC** und **Firebase (Spark-Tarif)**. Alle 3D-Modelle, Texturen, Karten, UI-Vektorgrafiken und Soundeffekte werden zu **100 % prozedural im Code** generiert (keine externen Bild-, Modell- oder Audiodateien).

Live-Instanz: **`https://weblorant.web.app`**

---

## Inhaltsverzeichnis

1. [Spielkonzept: Kernbruch & Splitter-Ökonomie](#spielkonzept-kernbruch--splitter-ökonomie)
2. [Spezialisten & Fähigkeiten](#spezialisten--fähigkeiten)
3. [Waffen-Arsenal & Schilde](#waffen-arsenal--schilde)
4. [Karten](#karten)
5. [Steuerung](#steuerung)
6. [System- & Modul-Architektur](#system--modul-architektur)
7. [Multiplayer- & Netcode-Architektur](#multiplayer--netcode-architektur)
8. [Lokales Setup & Entwicklung](#lokales-setup--entwicklung)
9. [Optionale STUN/TURN-Konfiguration](#optionale-stunturn-konfiguration)
10. [Deployment auf ein eigenes Firebase-Projekt (Spark-Tarif)](#deployment-auf-ein-eigenes-firebase-projekt-spark-tarif)

---

## Spielkonzept: Kernbruch & Splitter-Ökonomie

Im Hauptmodus **Kernbruch** treten zwei Teams (bis zu **5 gegen 5**, standardmäßig **First-to-7** Runden) als **Angreifer (Team A)** und **Verteidiger (Team D)** gegeneinander an:

- **Kaufphase (`25 s`)**: Beide Teams starten in ihren Spawn-Zonen hinter energetischen Barrieren und rüsten sich über das Kaufmenü (`B`) mit **Splittern (`◆`)** aus.
- **Aktionsphase (`100 s`)**: Die Spawn-Barrieren senken sich. Die Angreifer versuchen, den **Kern** in **Zone A** oder **Zone B** zu platzieren (`4,0 s` Platzierungsdauer), während die Verteidiger die Zonen sichern.
- **Kern platziert (`40 s` Zündzeit)**: Sobald der Kern aktiv ist, ticken `40 s` bis zur Detonation herunter. Verteidiger können den Kern entschärfen (`7,0 s` Gesamtdauer mit einem **Halbzeit-Checkpoint bei `50 %` / `3,5 s`**).
- **Rundenende (`4,5 s`) & Seitenwechsel**: Nach **6 gespielten Runden** wechseln Angreifer und Verteidiger die Seiten; Ausrüstung und Splitter werden auf den Startwert zurückgesetzt. Bei einem Gleichstand von **`6 : 6`** entscheidet eine **Sudden-Death-Entscheidungsrunde** mit `◆ 5.000` Start-Splittern für alle Spieler.

### Splitter-Ökonomie (`◆`)

| Ereignis | Splitter (`◆`) | Hinweis |
| :--- | :--- | :--- |
| Startkapital (Runde 1 & nach Seitenwechsel) | `◆ 800` | Grundausstattung inkl. kostenloser Sekundärwaffe *Funke* |
| Runden-Sieg | `+ ◆ 2.800` | Für alle Spieler des Siegerteams |
| Runden-Niederlage (1. / 2. / 3.+ in Folge) | `+ ◆ 1.800` / `2.300` / `2.800` | Gestaffelter Verlustserien-Bonus |
| Ausschaltung (Kill) | `+ ◆ 200` | Individueller Bonus pro erzieltem Kill |
| Kern-Platzierung | `+ ◆ 300` | Team-Bonus für alle Angreifer |
| Sudden Death (`6 : 6`) | `◆ 5.000` | Fester Gleichstands-Etat für beide Teams |
| Maximalbestand | `◆ 9.000` | Obergrenze des Kontos |

### 3-Slot-Loadout

Jeder Spieler führt ein klares **3-Slot-Loadout** plus optionalen **Kern**:
- **Slot `1` — Primärwaffe**: *Hornisse*, *Brecher*, *Lanze* oder *Falke* (bleibt bei Überleben in die nächste Runde erhalten).
- **Slot `2` — Sekundärwaffe**: *Funke* (Standard, kostenlos) oder *Bolzer*.
- **Slot `3` — Taktik-Klinge**: Nahkampfwaffe mit erhöhter Laufgeschwindigkeit (`6,15 m/s` statt `5,60 m/s`).
- **Taste `4` / `E` — Kern-Interaktion**: Aufnehmen, Platzieren in Zone A/B oder Entschärfen des platzierten Kerns.

Zusätzlich stehen im **Arsenal** vier kostenlose, sofort für alle Spieler freigeschaltete Waffen-Farbschemata (*Standard*, *Arktisch*, *Glutkern*, *Titan*) sowie lokale **Einsatzziele** und ein **Match-Verlauf** bereit.

---

## Spezialisten & Fähigkeiten

Alle vier Spezialisten verfügen über zwei kauf- bzw. aufladbare Taktik-Fähigkeiten (`Q`, `E`) und eine Ultimate-Fähigkeit (`X`), die über Kills, Tode, Kern-Aktionen und Rundenfortschritt aufgeladen wird:

| Spezialist | Rolle | `[Q]` Taktik 1 | `[E]` Taktik 2 | `[X]` Ultimate |
| :--- | :--- | :--- | :--- | :--- |
| **Ryo Kade** | Vorstoß | **Gleitschritt** (`◆ 150`, max. 2): Kurzer kinetischer Dash in Laufrichtung (`0,3 s` Waffen-Bereitschaftszeit). | **Adrenalin** (`Gratis`, 1 pro Runde): `4 s` beschleunigtes Nachladen und Waffenwechseln. | **Überlast** (`6 Pkt.`): `8 s` erhöhte Bewegungsgeschwindigkeit und `-30 %` Rückstoß. |
| **Mira Solen** | Aufklärer | **Echo-Puls** (`◆ 250`, max. 1): Werfbarer Akustik-Sensor, markiert Gegner im `12 m`-Radius für `2 s`. | **Störsender** (`◆ 200`, max. 1): Impulsgranate, verlangsamt Gegner im Wirkbereich `3 s` lang um `40 %`. | **Weitblick** (`7 Pkt.`): Enthüllt alle lebenden Gegner `3 s` lang für das gesamte Team (inkl. Minimap). |
| **Brann Okafor** | Kontrolleur | **Nebelkuppel** (`◆ 100`, max. 2): Undurchsichtige Rauchkuppel (`12 s`) an anvisierter Position (bis `30 m`). | **Glutfeld** (`◆ 200`, max. 1): Thermischer Bodenteppich mit `25 Schaden/s` über `4 s`. | **Dunkelzone** (`7 Pkt.`): Großflächiger Rauchring um den Zielpunkt für `15 s`. |
| **Tessa Vahl** | Wächter | **Magnetanker** (`◆ 200`, max. 2): Annäherungsfalle, die auslösende Gegner markiert und verlangsamt. | **Schildpfosten** (`Gratis`, 1 pro Runde): Hüfthohe taktische Deckungsbarriere (`400 HP`, `20 s`). | **Bollwerk** (`7 Pkt.`): Schutzzone (`6 s`), in der Verbündete `50 %` weniger Schaden erleiden. |

---

## Waffen-Arsenal & Schilde

Alle Schusswaffen nutzen deterministische Rückstoß-Kurven (`RecoilPoint[]`), bewegungsabhängige Streuung (Stand, Hocke, Gehen, Laufen, Sprung) sowie distanzabhängigen Schadensabfall:

| Waffe | Kategorie | Preis | Modus / Feuerrate | Magazin / Reserve | Schaden (Kopf / Körper, nah) | Besonderheit |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Funke** | Pistole | `GRATIS` | Halbautomatik (`6,0 /s`) | `12 / 36` | `75 / 26` | Präzise Standard-Sekundärwaffe |
| **Bolzer** | Schwere Pistole | `◆ 500` | Halbautomatik (`2,0 /s`) | `6 / 24` | `150 / 50` | Hoher Einzelschuss-Durchschlag |
| **Hornisse** | Maschinenpistole | `◆ 1.500` | Vollautomatik (`13,0 /s`) | `30 / 90` | `70 / 25` | Hohe Kadenz für Nah- & Mitteldistanz |
| **Brecher** | Schrotflinte | `◆ 1.800` | Halbautomatik (`1,2 /s`) | `6 / 18` | `8 × 30 / 8 × 12` | `8` Schrotkugeln pro Schuss im Nahkampf |
| **Lanze** | Sturmgewehr | `◆ 2.900` | Vollautomatik (`9,5 /s`) | `25 / 75` | `150 / 40` | Konstante Präzision ohne Distanzabfall |
| **Falke** | Präzisionsgewehr | `◆ 4.500` | Repetierer (`0,7 /s`) | `5 / 15` | `255 / 150` | Rechtsklick-Zielfernrohr (Zoom), 1-Treffer-Potenzial |

**Verteidigung (Schilde)** — absorbiert `66 %` des eingehenden Trefferschadens vor den `100` Lebenspunkten:
- **Leichter Schild** (`◆ 400`): `+25` Schildpunkte
- **Schwerer Schild** (`◆ 1.000`): `+50` Schildpunkte

---

## Karten

Alle vier Karten sind datengetrieben definiert (`src/data/maps/`) und verbinden Rapier-Kollisionsgeometrie mit gebatchter Three.js-Darstellung sowie Live-2D-Minimap-Projektion:

1. **Hafenwerk (`hafenwerk`)**: Klassische Zwei-Zonen-Container- und Krananlage am Industriekai mit klarer 3-Spur-Struktur (Langstrecke A, Zentralhalle/Mitte, Lagerdock B).
2. **Werkstadt (`werkstadt`)**: Vertikal gestaffeltes Fertigungswerk mit erhöhten Laufstegen, Mittelbrücke und verwinkelten Zugängen zu den Kern-Zonen A und B.
3. **Kryowerk (`kryowerk`)**: Arktische Forschungs- und Kühlanlage mit klaren Sichtachsen, Reaktor-Mitteltrakt und taktischen Engpässen.
4. **Übungsanlage (`uebungsanlage`)**: Offline-Trainingsgelände mit Schießbahn, interaktiven Distanz- und `30er`-Zeit-Challenges (beschießbare 3D-Schalter), beweglichen Trainings-Zielen, unbegrenzten Splittern im Kaufmenü und schnellem Spezialisten-Wechsel (`F2`).

---

## Steuerung

| Taste / Eingabe | Aktion |
| :--- | :--- |
| `W`, `A`, `S`, `D` | Bewegen (Vorwärts, Links, Rückwärts, Rechts) |
| `Umschalttaste (Shift)` (halten) | Leises Gehen (`3,0 m/s`, keine Schrittgeräusche, geringere Streuung) |
| `Strg` oder `C` | Hocken (`2,4 m/s`, reduzierte Trefferfläche & engere Streuung) |
| `Leertaste` | Springen |
| `Linke Maustaste` | Feuern / Klingen-Angriff |
| `Rechte Maustaste` | Visierung / Zielfernrohr (*Falke*-Zoom bzw. Fokus-Ansicht) |
| `R` | Waffe nachladen |
| `1` / `2` / `3` | Primärwaffe (`1`), Sekundärwaffe (`2`), Taktik-Klinge (`3`) ausrüsten |
| `B` | Taktisches 6-Zonen-Kaufmenü öffnen / schließen |
| `4` oder `E` (halten in Zone / am Kern) | **Kern** aufnehmen, in Zone A/B platzieren oder entschärfen |
| `Q` / `E` / `X` | Spezialisten-Fähigkeit 1 (`Q`), Fähigkeit 2 (`E`), Ultimate (`X`) einsetzen |
| `Tab` (halten) | Taktisches Live-Scoreboard (`K / T / A`, Splitter, Ultimate, Ping & Transportmodus) |
| `Enter` | In-Game-Chat öffnen (`Tab` im Eingabefeld wechselt `[ALLE]` / `[TEAM]`, `Esc` schließt) |
| `F1` | Kompakte Fähigkeits-Übersicht des aktuellen Spezialisten ein-/ausblenden |
| `F2` | Schneller Spezialisten-Wechsel (in der *Übungsanlage*) |
| `F3` | Netcode- & Telemetrie-Diagnosepanel (inkl. Latenz-/Paketverlust-/Relay-Simulator) |
| `Esc` | Einstellungs- & Pausenmenü (Mausempfindlichkeit, Sichtfeld, Lautstärke, Fadenkreuz) |

---

## System- & Modul-Architektur

Das Projekt trennt die deterministische Spielsimulation strikt von Rendering, Audio und Browser-DOM (`0` `three`- oder DOM-Abhängigkeiten in `src/game/**`):

```text
src/
├── core/       # Fixe 30-Hz-GameLoop, InputManager, EventBus, Vektor-/Zufalls-Mathematik, zentrale Typen & Konstanten
├── data/       # Waffen- & Rückstoßprofile, Spezialisten, 4 Kartendefinitionen, prozedurale UI-SVGs & Karriere-Fortschritt
├── physics/    # Rapier-3D-Kapsel-Controller, Weltkollisionen, Trefferzonen-Raycasting (Kopf / Körper / Welt / Schalter)
├── game/       # 100 % deterministische Spiellogik (Waffen, Fähigkeiten, Runden, Ökonomie, Kern, HostSimulation, OnlineSession, LagComp)
├── net/        # Kompaktes Wire-Protokoll, WebRTC-Stern-PeerManager, RTDB-Relay-Fallback, Uhrensynchronisation & NetSimulator
├── firebase/   # Firebase App/Auth (Anonymous Auth) & Realtime Database Lobby-, Raumcode-, Presence- und Signaling-Service
├── render/     # Three.js-Szene, prozedurale PBR-Canvas-Texturen, Geometrie-Batching (MapBuilder), First-/Third-Person-Modelle & Effekte
├── audio/      # Prozeduraler Web-Audio-Synthesizer (Waffenklänge, Schritte, Treffer-Feedback, Fähigkeiten, Kern-Signaltöne)
└── ui/         # Taktische Client-Shell (LobbyScreen), 6-Zonen-Kaufmenü, symmetrisches HUD, 2D-Minimap, Scoreboard & In-Game-Chat
tests/          # 10 Vitest-Suites (Waffen, Rückstoß, Ökonomie, Runden, Fähigkeiten, Karten, Lobby, Netcode, LagComp, Progression)
```

- **Geometrie-Batching (`src/render/MapBuilder.ts`)**: Statische Kartenblöcke gleicher Material- und Farbgruppe werden zu zusammengeführten `BufferGeometry`-Meshes gebündelt, um die Draw-Calls für flüssige `60+ FPS` auch auf integrierten Laptop-GPUs niedrig zu halten.
- **Vendor-Chunk-Aufteilung (`vite.config.ts`)**: `three`, `@dimforge/rapier3d-compat` und `firebase` werden beim Produktions-Build in separate Pakete (`vendor-three`, `vendor-rapier`, `vendor-firebase`) getrennt.

---

## Multiplayer- & Netcode-Architektur

SHARDLINE kommt vollständig **ohne dedizierte Cloud-Gameserver** aus und läuft komplett im kostenlosen **Firebase Spark-Tarif**:

1. **Authentifizierung, Lobby & Presence (`src/firebase/`)**:
   - Automatische Anmeldung per **Firebase Anonymous Auth**.
   - Raum-Erstellung und Beitritt über 6-stellige Raumcodes in der **Firebase Realtime Database (RTDB)** inklusive `onDisconnect()`-Presence-Überwachung und strengen Sicherheitsregeln (`database.rules.json`).
2. **WebRTC-Stern-Topologie mit Dual-DataChannels (`src/net/PeerManager.ts`)**:
   - Der Raum-Ersteller fungiert als **autoritärer Host (`30 Hz` Tickrate)**; alle weiteren Mitspieler verbinden sich sternförmig per WebRTC direkt mit dem Host:
     - Kanal **`"state"`** (`ordered: false, maxRetransmits: 0`, UDP-artig): Hochfrequente Client-Inputs und `20 Hz` Welt-Snapshots ohne Head-of-Line-Blocking.
     - Kanal **`"events"`** (`ordered: true`, zuverlässig): Schuss-Events, Treffer, Phasenwechsel, Kaufbestätigungen, Fähigkeiten und Team-/Alle-Chat (mit Host-seitiger Bereinigung, Rate-Limit und echter Netzwerk-Isolation für Team-Nachrichten).
3. **Automatischer RTDB-Relay-Fallback (`8 s` Timeout, `10 Hz`)**:
   - Falls restriktive NATs oder Firewalls eine direkte WebRTC-Verbindung nach **`8.000 ms`** verhindern (oder im `F3`-Panel der Relay-Modus erzwungen wird), schaltet die Verbindung nahtlos und unterbrechungsfrei auf verschlüsselten Pakettransport über `rooms/{code}/relay/{peerUid}` mit gedrosselter `10 Hz`-Rate um.
4. **Prediction, Interpolation & Lag Compensation (`src/game/`)**:
   - **Client-Side Prediction & Server-Reconciliation**: Eigene Bewegungen werden sofort lokal mit `30 Hz` simuliert; bestätigt der Host abweichende Positionen (`lastAckSeq`), spielt der Client unbestätigte Inputs deterministisch nach.
   - **Entity-Interpolation (`100 ms` Puffer)**: Entfernte Spieler werden weich zwischen autoritativen Host-Snapshots interpoliert.
   - **Host-seitige Lag Compensation (`bis 200 ms` Rewind)**: Bei jedem Schuss spult der Host die Kapsel-Hitboxen der Ziele anhand eines `1.000 ms`-Ringpuffers auf die geschätzte Sichtzeit des Schützen zurück (geclampt auf maximal `200 ms`) und prüft Sichtlinie sowie Kopf-/Körpertreffer autoritativ nach.

---

## Lokales Setup & Entwicklung

### Voraussetzungen
- **Node.js** `>= 20` und **npm**

### Installation & Start

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Lokale Umgebungsvariablen anlegen
cp .env.example .env.local
```

Trage in `.env.local` deine Firebase-Web-App-Konfiguration ein (für den reinen **Offline-Trainingsmodus** auf allen vier Karten startet SHARDLINE auch komplett ohne Internetverbindung oder Firebase-Zugangsdaten):

```env
VITE_FIREBASE_API_KEY=dein-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=dein-projekt.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://dein-projekt-default-rtdb.europe-west1.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=dein-projekt
VITE_FIREBASE_STORAGE_BUCKET=dein-projekt.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef123456
VITE_USE_FIREBASE_EMULATOR=false
```

### Entwicklungs- & Prüf-Befehle

```bash
# Entwicklungsserver mit Hot-Reload starten
npm run dev

# Alle Unit- & Integrations-Tests (Vitest) ausführen
npx vitest run

# TypeScript-Typprüfung & Produktions-Build nach dist/ erzeugen
npm run build

# Produktions-Build lokal testen
npm run preview
```

---

## Optionale STUN/TURN-Konfiguration

Standardmäßig nutzt `src/net/config.ts` den öffentlichen STUN-Server `stun:stun.l.google.com:19302` sowie bei Bedarf den automatischen Firebase-RTDB-Relay-Fallback. Wer zusätzlich einen eigenen **TURN-Server** (z. B. `coturn` oder Cloudflare Calls TURN) einbinden möchte, setzt optional folgende Variablen in `.env.local` (Geheimnisse werden niemals im Quellcode hinterlegt):

```env
VITE_ICE_STUN_URL=stun:stun.l.google.com:19302
VITE_ICE_TURN_URL=turn:turn.beispiel-domain.de:3478?transport=udp
VITE_ICE_TURN_USERNAME=dein-turn-benutzer
VITE_ICE_TURN_CREDENTIAL=dein-turn-schluessel
```

Mehrere STUN- oder TURN-URLs können kommagetrennt angegeben werden.

---

## Deployment auf ein eigenes Firebase-Projekt (Spark-Tarif)

SHARDLINE benötigt ausschließlich kostenlose Dienste des **Firebase Spark-Tarifs** (*Authentication*, *Realtime Database* und *Hosting* — keine Cloud Functions, kein Blaze-Abo):

1. **Firebase-Projekt anlegen**:
   - Öffne die [Firebase Console](https://console.firebase.google.com/) und erstelle ein neues Projekt im kostenlosen **Spark-Tarif**.
2. **Anonymous Authentication aktivieren**:
   - Navigiere zu **Build → Authentication → Sign-in method** und aktiviere den Anbieter **Anonym (Anonymous)**.
3. **Realtime Database erstellen**:
   - Navigiere zu **Build → Realtime Database → Datenbank erstellen**, wähle z. B. den Standort **`europe-west1` (Belgien)** und starte im gesperrten Modus (die exakten Regeln werden im nächsten Schritt aus `database.rules.json` übernommen).
4. **Web-App registrieren & `.env.local` befüllen**:
   - Füge in den Projekteinstellungen eine **Web-App (`</>`)** hinzu und übernimm die Konfigurationswerte (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`) in deine lokale `.env.local`.
   - Passe in `.firebaserc` den Projektnamen unter `"default"` auf deine neue `projectId` an.
5. **Bauen & Veröffentlichen**:
   ```bash
   # Produktions-Bundle nach dist/ erstellen
   npm run build

   # Bei Firebase anmelden (einmalig)
   npx firebase-tools@latest login

   # Sicherheitsregeln (Realtime Database) und Web-Client (Hosting) veröffentlichen
   npx firebase-tools@latest deploy --only database,hosting
   ```

Nach erfolgreichem Deployment ist deine eigene SHARDLINE-Instanz sofort unter `https://<deine-project-id>.web.app` erreichbar.
