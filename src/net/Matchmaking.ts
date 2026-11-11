import type { TeamId } from '../core/types';

/**
 * Reine, deterministische Matchmaking-Logik (kein DOM, kein Firebase).
 *
 * Ziele:
 *  1. Spieler im selben lokalen Netzwerk (gleicher `netKey`) werden immer gemeinsam
 *     in ein Match gelegt – lokale Gruppen werden automatisch „mitangesprochen“.
 *  2. Spieler, die übers Web queuen, füllen diese lokalen Gruppen auf.
 *  3. Der Host (Stern-Topologie) und die Auffüller werden so gewählt, dass die
 *     geschätzte Latenz für den größten Anteil der Spieler minimal ist.
 *  4. Teams bis 5 müssen nicht voll sein: nach einer Wartezeit startet das Match
 *     auch mit weniger Spielern (mind. 2).
 */

export interface QueueEntry {
  uid: string;
  name: string;
  /** Gehashter Netzwerk-Schlüssel (öffentliche IPv4 bzw. IPv6-/64-Präfix). `null` = unbekannt. */
  netKey: string | null;
  /** Gemessene Round-Trip-Zeit zum Signalisierungsserver in ms. */
  rttMs: number;
  /** `Date#getTimezoneOffset()` in Minuten – grobe geografische Lage. */
  tzOffsetMin: number;
  joinedAt: number;
  lastSeen: number;
  /** Gewünschte maximale Teamgröße (1..5). */
  teamSize: number;
  /** Bereits einem Match zugewiesen? */
  matchId?: string | null;
}

export interface PlannedMember {
  uid: string;
  team: TeamId;
}

export interface MatchPlan {
  hostUid: string;
  teamSize: number;
  members: PlannedMember[];
  /** Mittlere geschätzte Latenz aller Nicht-Hosts zum Host (ms). */
  avgLatencyMs: number;
  /** Lokale Gruppen (≥2 Spieler im selben Netz), als UID-Listen. */
  localGroups: string[][];
  /** true, wenn das Match ohne volle Teams startet. */
  partial: boolean;
}

export interface PlanOptions {
  /** Wie lange ein Eintrag ohne Heartbeat noch gilt. */
  staleAfterMs?: number;
  /** Nach dieser Wartezeit wird auch mit nicht vollen Teams gestartet. */
  fillWaitMs?: number;
  /** Rein lokale Gruppe ohne Web-Mitspieler startet nach dieser Wartezeit. */
  lanOnlyWaitMs?: number;
  minPlayers?: number;
}

export const LAN_LATENCY_MS = 2;
export const QUEUE_STALE_MS = 15_000;
export const QUEUE_FILL_WAIT_MS = 25_000;
export const QUEUE_LAN_ONLY_WAIT_MS = 10_000;

/**
 * Geschätzte Einweg-Latenz zwischen zwei Spielern in ms.
 * Gleiches Netz ⇒ LAN. Sonst: Anteil der jeweiligen Server-RTT + Distanz über Zeitzonen.
 */
export function estimateLatencyMs(a: QueueEntry, b: QueueEntry): number {
  if (a.uid === b.uid) return 0;
  if (a.netKey && a.netKey === b.netKey) return LAN_LATENCY_MS;
  const rttA = clampRtt(a.rttMs);
  const rttB = clampRtt(b.rttMs);
  const tzHours = Math.abs(a.tzOffsetMin - b.tzOffsetMin) / 60;
  // ~15° Längengrad pro Stunde ≈ 1100 km ≈ 9 ms Einweg über Glasfaser inkl. Routing
  return 8 + (rttA + rttB) * 0.25 + tzHours * 9;
}

function clampRtt(rtt: number): number {
  return Number.isFinite(rtt) && rtt > 0 ? Math.min(rtt, 600) : 120;
}

/** Fasst Einträge zu lokalen Gruppen zusammen (gleicher netKey). */
export function clusterByNetwork(entries: ReadonlyArray<QueueEntry>): QueueEntry[][] {
  const byKey = new Map<string, QueueEntry[]>();
  const singles: QueueEntry[][] = [];
  for (const e of entries) {
    if (!e.netKey) {
      singles.push([e]);
      continue;
    }
    const list = byKey.get(e.netKey);
    if (list) list.push(e);
    else byKey.set(e.netKey, [e]);
  }
  const clusters = [...byKey.values(), ...singles];
  for (const c of clusters) c.sort(compareByAge);
  clusters.sort((x, y) => y.length - x.length || compareByAge(x[0], y[0]));
  return clusters;
}

function compareByAge(a: QueueEntry, b: QueueEntry): number {
  return a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid);
}

/** Wählt den Host, der die Summe der geschätzten Latenzen minimiert. */
export function pickBestHost(members: ReadonlyArray<QueueEntry>): { host: QueueEntry; avgLatencyMs: number } {
  let best = members[0];
  let bestSum = Number.POSITIVE_INFINITY;
  for (const cand of members) {
    let sum = 0;
    for (const m of members) sum += estimateLatencyMs(cand, m);
    // Tiebreak: niedrigere eigene Server-RTT (stabilere Verbindung), dann Alter
    if (
      sum < bestSum - 1e-6 ||
      (Math.abs(sum - bestSum) < 1e-6 &&
        (clampRtt(cand.rttMs) < clampRtt(best.rttMs) ||
          (clampRtt(cand.rttMs) === clampRtt(best.rttMs) && compareByAge(cand, best) < 0)))
    ) {
      best = cand;
      bestSum = sum;
    }
  }
  const others = Math.max(1, members.length - 1);
  return { host: best, avgLatencyMs: bestSum / others };
}

/** Mittlere Latenz eines Clusters zu einer bestehenden Auswahl. */
function clusterCost(cluster: ReadonlyArray<QueueEntry>, selected: ReadonlyArray<QueueEntry>): number {
  let sum = 0;
  for (const c of cluster) for (const s of selected) sum += estimateLatencyMs(c, s);
  return sum / Math.max(1, cluster.length * selected.length);
}

/**
 * Verteilt Spieler auf zwei Teams. Lokale Gruppen bleiben möglichst zusammen
 * (gleiches Team), Teamgrößen bleiben ausgeglichen (Differenz ≤ 1).
 */
export function assignTeams(
  clusters: ReadonlyArray<ReadonlyArray<QueueEntry>>,
  teamSize: number,
): PlannedMember[] {
  const total = clusters.reduce((n, c) => n + c.length, 0);
  const capA = Math.min(teamSize, Math.ceil(total / 2));
  const capD = Math.min(teamSize, total - capA);
  const teamA: string[] = [];
  const teamD: string[] = [];
  const sorted = [...clusters].sort((x, y) => y.length - x.length || compareByAge(x[0], y[0]));
  const leftovers: QueueEntry[] = [];

  for (const cluster of sorted) {
    const freeA = capA - teamA.length;
    const freeD = capD - teamD.length;
    // Ganze Gruppe ins Team mit mehr Platz, falls sie passt
    if (cluster.length <= Math.max(freeA, freeD)) {
      const target = freeA >= freeD ? teamA : teamD;
      for (const m of cluster) target.push(m.uid);
    } else {
      leftovers.push(...cluster);
    }
  }
  for (const m of leftovers) {
    if (teamA.length < capA && (teamA.length <= teamD.length || teamD.length >= capD)) teamA.push(m.uid);
    else teamD.push(m.uid);
  }

  return [
    ...teamA.map((uid) => ({ uid, team: 'A' as TeamId })),
    ...teamD.map((uid) => ({ uid, team: 'D' as TeamId })),
  ];
}

/**
 * Plant genau ein Match aus der aktuellen Warteschlange – oder `null`, wenn noch
 * gewartet werden soll. Deterministisch: gleiche Eingabe ⇒ gleicher Plan.
 */
export function planMatch(
  allEntries: ReadonlyArray<QueueEntry>,
  nowMs: number,
  teamSize: number,
  opts: PlanOptions = {},
): MatchPlan | null {
  const staleAfterMs = opts.staleAfterMs ?? QUEUE_STALE_MS;
  const fillWaitMs = opts.fillWaitMs ?? QUEUE_FILL_WAIT_MS;
  const lanOnlyWaitMs = opts.lanOnlyWaitMs ?? QUEUE_LAN_ONLY_WAIT_MS;
  const minPlayers = Math.max(2, opts.minPlayers ?? 2);
  const size = Math.max(1, Math.min(5, Math.round(teamSize)));
  const target = size * 2;

  const live = allEntries.filter(
    (e) => !e.matchId && e.teamSize === size && nowMs - e.lastSeen <= staleAfterMs,
  );
  if (live.length < minPlayers) return null;

  const clusters = clusterByNetwork(live);

  // --- Auswahl: größte lokale Gruppe als Kern, dann günstigste Auffüller ---
  const selectedClusters: QueueEntry[][] = [];
  const selected: QueueEntry[] = [];
  const remaining = clusters.map((c) => [...c]);

  const seed = remaining.shift()!;
  const seedTake = seed.slice(0, target);
  selectedClusters.push(seedTake);
  selected.push(...seedTake);

  while (selected.length < target && remaining.length > 0) {
    const free = target - selected.length;
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const cost = clusterCost(c, selected);
      // Ganze Gruppen, die passen, werden bevorzugt (lokale Gruppen nicht zerreißen);
      // größere Gruppen bekommen einen Bonus, weil mehr Spieler profitieren.
      const fits = c.length <= free;
      const score = cost - (fits ? Math.min(c.length, free) * 1.5 : -25);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const pick = remaining.splice(bestIdx, 1)[0];
    const take = pick.slice(0, free);
    selectedClusters.push(take);
    selected.push(...take);
  }

  // --- Startbedingung ---
  const oldestWait = nowMs - Math.min(...selected.map((e) => e.joinedAt));
  const full = selected.length >= target;
  const onlyLan =
    selected.length >= minPlayers &&
    selected.every((e) => e.netKey && e.netKey === selected[0].netKey) &&
    live.length === selected.length;

  const ready =
    full ||
    (selected.length >= minPlayers && oldestWait >= fillWaitMs) ||
    (onlyLan && oldestWait >= lanOnlyWaitMs);
  if (!ready) return null;

  const { host, avgLatencyMs } = pickBestHost(selected);
  const effectiveTeamSize = full ? size : Math.max(1, Math.ceil(selected.length / 2));
  const members = assignTeams(selectedClusters, effectiveTeamSize);

  const localGroups = clusterByNetwork(selected)
    .filter((c) => c.length >= 2 && c[0].netKey)
    .map((c) => c.map((e) => e.uid));

  return {
    hostUid: host.uid,
    teamSize: effectiveTeamSize,
    members,
    avgLatencyMs,
    localGroups,
    partial: !full,
  };
}

/** Deterministischer Koordinator: ältester aktiver Eintrag plant für alle. */
export function pickCoordinator(
  entries: ReadonlyArray<QueueEntry>,
  nowMs: number,
  teamSize: number,
  staleAfterMs = QUEUE_STALE_MS,
): string | null {
  const live = entries
    .filter((e) => !e.matchId && e.teamSize === teamSize && nowMs - e.lastSeen <= staleAfterMs)
    .sort(compareByAge);
  return live[0]?.uid ?? null;
}
