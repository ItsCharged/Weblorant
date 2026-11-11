import { get, onValue, ref, remove, set, type Unsubscribe, update } from 'firebase/database';
import { clamp } from '../core/math';
import {
  type CharacterId,
  isValidMapId,
  type LobbyPlayer,
  type MapId,
  type MatchPhase,
  type RoomMatchSummary,
  type RoomSettings,
  type RoomStatus,
  type TeamId,
} from '../core/types';
import { DEFAULT_CHARACTER_ID, isValidCharacterId } from '../data/characters';
import { ensureAnonymousAuth, getCurrentUid, savePlayerName } from './auth';
import { getFirebaseServices } from './init';
import { attachRoomPresence, type DetachPresenceFn } from './presence';
import {
  generateRoomCode,
  isRoomStaleOrOrphaned,
  isValidPlayerName,
  isValidRoomCode,
  normalizeRoomCode,
  pickBalancedTeam,
  sanitizePlayerName,
} from './roomCode';

export type LobbyErrorCode =
  | 'INVALID_NAME'
  | 'INVALID_CODE'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_CLOSED'
  | 'MATCH_ALREADY_STARTED'
  | 'ROOM_FULL'
  | 'TEAM_FULL'
  | 'NOT_HOST'
  | 'NOT_IN_ROOM'
  | 'CODE_GENERATION_FAILED'
  | 'INVALID_CHARACTER';

export class LobbyError extends Error {
  public readonly code: LobbyErrorCode;

  constructor(msg: string, code: LobbyErrorCode) {
    super(msg);
    this.name = 'LobbyError';
    this.code = code;
  }
}

export interface RoomSnapshot {
  code: string;
  hostUid: string;
  isHost: boolean;
  status: RoomStatus;
  settings: RoomSettings;
  players: LobbyPlayer[];
  match: RoomMatchSummary | null;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  teamSize: 3,
  roundsToWin: 7,
  mapId: 'hafenwerk',
};

interface RawPlayerRecord {
  name?: unknown;
  team?: unknown;
  character?: unknown;
  ready?: unknown;
  online?: unknown;
}

interface RawRoomRecord {
  hostUid?: unknown;
  status?: unknown;
  createdAt?: unknown;
  lastActive?: unknown;
  settings?: {
    teamSize?: unknown;
    roundsToWin?: unknown;
    mapId?: unknown;
  };
  players?: Record<string, RawPlayerRecord | undefined>;
  match?: {
    round?: unknown;
    scoreA?: unknown;
    scoreB?: unknown;
    phase?: unknown;
  };
}

function parseMapId(raw: unknown): MapId {
  return isValidMapId(raw) ? raw : 'hafenwerk';
}

function parseRoomStatus(raw: unknown): RoomStatus {
  if (raw === 'playing' || raw === 'ended') return raw;
  return 'lobby';
}

function parseMatchPhase(raw: unknown): MatchPhase {
  if (
    raw === 'buy' ||
    raw === 'action' ||
    raw === 'planted' ||
    raw === 'post_round' ||
    raw === 'ended'
  ) {
    return raw;
  }
  return 'buy';
}

function sanitizeRoomSettings(partial?: Partial<RoomSettings>, fallback = DEFAULT_ROOM_SETTINGS): RoomSettings {
  const rawTeamSize =
    typeof partial?.teamSize === 'number' && Number.isFinite(partial.teamSize)
      ? partial.teamSize
      : fallback.teamSize;
  const rawRounds =
    typeof partial?.roundsToWin === 'number' && Number.isFinite(partial.roundsToWin)
      ? partial.roundsToWin
      : fallback.roundsToWin;

  return {
    teamSize: clamp(Math.round(rawTeamSize), 1, 5),
    roundsToWin: clamp(Math.round(rawRounds), 1, 13),
    mapId: parseMapId(partial?.mapId ?? fallback.mapId),
  };
}

function parsePlayersList(
  rawPlayers: Record<string, RawPlayerRecord | undefined> | undefined,
  hostUid: string,
): LobbyPlayer[] {
  if (!rawPlayers) return [];
  const list: LobbyPlayer[] = [];

  for (const [uid, rec] of Object.entries(rawPlayers)) {
    if (!rec || typeof rec !== 'object') continue;
    const name = sanitizePlayerName(typeof rec.name === 'string' ? rec.name : 'Spieler');
    const team: TeamId = rec.team === 'D' ? 'D' : 'A';
    const character: CharacterId = isValidCharacterId(rec.character)
      ? rec.character
      : DEFAULT_CHARACTER_ID;
    const ready = Boolean(rec.ready);
    const online = rec.online !== false;

    list.push({
      uid,
      name: name || 'Spieler',
      team,
      character,
      ready,
      online,
    });
  }

  // Deterministic ordering: Host first, then alphabetical by name + uid
  list.sort((a, b) => {
    if (a.uid === hostUid && b.uid !== hostUid) return -1;
    if (b.uid === hostUid && a.uid !== hostUid) return 1;
    const byName = a.name.localeCompare(b.name, 'de');
    return byName !== 0 ? byName : a.uid.localeCompare(b.uid);
  });

  return list;
}

function parseRoomSnapshot(code: string, raw: RawRoomRecord, selfUid: string): RoomSnapshot {
  const hostUid = typeof raw.hostUid === 'string' ? raw.hostUid : '';
  const status = parseRoomStatus(raw.status);
  const settings = sanitizeRoomSettings({
    teamSize: typeof raw.settings?.teamSize === 'number' ? raw.settings.teamSize : undefined,
    roundsToWin:
      typeof raw.settings?.roundsToWin === 'number' ? raw.settings.roundsToWin : undefined,
    mapId: parseMapId(raw.settings?.mapId),
  });
  const players = parsePlayersList(raw.players, hostUid);

  let match: RoomMatchSummary | null = null;
  if (raw.match && typeof raw.match === 'object') {
    match = {
      round: typeof raw.match.round === 'number' ? raw.match.round : 1,
      scoreA: typeof raw.match.scoreA === 'number' ? raw.match.scoreA : 0,
      scoreB: typeof raw.match.scoreB === 'number' ? raw.match.scoreB : 0,
      phase: parseMatchPhase(raw.match.phase),
    };
  }

  return {
    code,
    hostUid,
    isHost: selfUid.length > 0 && hostUid === selfUid,
    status,
    settings,
    players,
    match,
  };
}

export type RoomUpdateCallback = (snapshot: RoomSnapshot | null) => void;
export type RoomClosedCallback = (reason: string) => void;

/**
 * High-level SHARDLINE Multiplayer Lobby & Room Lifecycle service backed by Firebase Auth + RTDB.
 */
export class LobbyService {
  private uid: string | null = null;
  private activeCode: string | null = null;
  private currentSnapshot: RoomSnapshot | null = null;
  private roomUnsubscribe: Unsubscribe | null = null;
  private detachPresence: DetachPresenceFn | null = null;
  private leavingVoluntarily = false;

  private readonly updateListeners = new Set<RoomUpdateCallback>();
  private readonly closedListeners = new Set<RoomClosedCallback>();

  public getUid(): string | null {
    return this.uid ?? getCurrentUid();
  }

  public getCurrentSnapshot(): RoomSnapshot | null {
    return this.currentSnapshot;
  }

  public onRoomUpdate(cb: RoomUpdateCallback): () => void {
    this.updateListeners.add(cb);
    return () => {
      this.updateListeners.delete(cb);
    };
  }

  public onRoomClosed(cb: RoomClosedCallback): () => void {
    this.closedListeners.add(cb);
    return () => {
      this.closedListeners.delete(cb);
    };
  }

  private emitRoomUpdate(snap: RoomSnapshot | null): void {
    for (const cb of Array.from(this.updateListeners)) {
      cb(snap);
    }
  }

  private emitRoomClosed(reason: string): void {
    for (const cb of Array.from(this.closedListeners)) {
      cb(reason);
    }
  }

  public async initAuth(): Promise<string> {
    const { uid } = await ensureAnonymousAuth();
    this.uid = uid;
    return uid;
  }

  public async createRoom(
    playerName: string,
    partialSettings?: Partial<RoomSettings>,
  ): Promise<RoomSnapshot> {
    const cleanName = sanitizePlayerName(playerName);
    if (!isValidPlayerName(cleanName)) {
      throw new LobbyError(
        'Bitte gib einen gültigen Anzeigenamen (1–16 Zeichen) ein.',
        'INVALID_NAME',
      );
    }

    const uid = await this.initAuth();
    savePlayerName(cleanName);

    if (this.activeCode) {
      await this.leaveRoom();
    }

    const { db } = getFirebaseServices();
    const settings = sanitizeRoomSettings(partialSettings);
    let chosenCode: string | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateRoomCode();
      const existing = await get(ref(db, `rooms/${candidate}`));
      if (!existing.exists()) {
        chosenCode = candidate;
        break;
      }
    }

    if (!chosenCode) {
      throw new LobbyError(
        'Es konnte kein freier Raumcode erzeugt werden. Bitte erneut versuchen.',
        'CODE_GENERATION_FAILED',
      );
    }

    const now = Date.now();
    const initialRoom = {
      hostUid: uid,
      status: 'lobby' as RoomStatus,
      createdAt: now,
      lastActive: now,
      settings,
      players: {
        [uid]: {
          name: cleanName,
          team: 'A' as TeamId,
          character: DEFAULT_CHARACTER_ID,
          ready: true,
          online: true,
        },
      },
    };

    await set(ref(db, `rooms/${chosenCode}`), initialRoom);
    return this.bindToRoom(chosenCode, uid, true, initialRoom);
  }

  /**
   * @param preferredTeam Vom Matchmaking vorgegebenes Team (lokale Gruppen bleiben zusammen).
   *   Wird nur verwendet, wenn dort noch Platz ist.
   */
  public async joinRoom(
    rawCode: string,
    playerName: string,
    preferredTeam?: TeamId,
  ): Promise<RoomSnapshot> {
    const cleanName = sanitizePlayerName(playerName);
    if (!isValidPlayerName(cleanName)) {
      throw new LobbyError(
        'Bitte gib einen gültigen Anzeigenamen (1–16 Zeichen) ein.',
        'INVALID_NAME',
      );
    }

    const code = normalizeRoomCode(rawCode);
    if (!isValidRoomCode(code)) {
      throw new LobbyError(
        'Ungültiger Raumcode. Erlaubt sind 5 Zeichen ohne 0, O, 1 und I.',
        'INVALID_CODE',
      );
    }

    const uid = await this.initAuth();
    savePlayerName(cleanName);

    if (this.activeCode && this.activeCode !== code) {
      await this.leaveRoom();
    }

    const { db } = getFirebaseServices();
    const roomRef = ref(db, `rooms/${code}`);
    const snap = await get(roomRef);

    if (!snap.exists()) {
      throw new LobbyError(
        `Raum „${code}“ wurde nicht gefunden.`,
        'ROOM_NOT_FOUND',
      );
    }

    const rawRoom = snap.val() as RawRoomRecord;
    const now = Date.now();

    if (
      isRoomStaleOrOrphaned(
        {
          status: typeof rawRoom.status === 'string' ? rawRoom.status : undefined,
          createdAt: typeof rawRoom.createdAt === 'number' ? rawRoom.createdAt : undefined,
          lastActive: typeof rawRoom.lastActive === 'number' ? rawRoom.lastActive : undefined,
          hostUid: typeof rawRoom.hostUid === 'string' ? rawRoom.hostUid : undefined,
          players: rawRoom.players as Record<string, { online?: boolean }> | undefined,
        },
        now,
      )
    ) {
      throw new LobbyError(
        'Raum existiert nicht mehr oder wurde geschlossen.',
        'ROOM_CLOSED',
      );
    }

    const parsedBeforeJoin = parseRoomSnapshot(code, rawRoom, uid);
    if (parsedBeforeJoin.status !== 'lobby') {
      throw new LobbyError('Match läuft bereits.', 'MATCH_ALREADY_STARTED');
    }

    const existingSelf = parsedBeforeJoin.players.find((p) => p.uid === uid);
    let assignedTeam: TeamId;
    let assignedChar: CharacterId = DEFAULT_CHARACTER_ID;
    const isHost = parsedBeforeJoin.hostUid === uid;

    if (existingSelf) {
      assignedTeam = existingSelf.team;
      assignedChar = existingSelf.character;
    } else {
      const others = parsedBeforeJoin.players.filter((p) => p.uid !== uid);
      const preferredHasSpace =
        preferredTeam !== undefined &&
        others.filter((p) => p.online && p.team === preferredTeam).length <
          parsedBeforeJoin.settings.teamSize;
      const balanced = preferredHasSpace
        ? preferredTeam
        : pickBalancedTeam(others, parsedBeforeJoin.settings.teamSize);
      if (!balanced) {
        throw new LobbyError('Raum ist voll.', 'ROOM_FULL');
      }
      assignedTeam = balanced;
    }

    const playerRef = ref(db, `rooms/${code}/players/${uid}`);
    await set(playerRef, {
      name: cleanName,
      team: assignedTeam,
      character: assignedChar,
      ready: isHost,
      online: true,
    });
    await set(ref(db, `rooms/${code}/lastActive`), Date.now());

    const refreshedSnap = await get(roomRef);
    const latestRaw = (refreshedSnap.val() as RawRoomRecord | null) ?? rawRoom;
    return this.bindToRoom(code, uid, isHost, latestRaw);
  }

  private bindToRoom(
    code: string,
    uid: string,
    isHost: boolean,
    initialRaw: RawRoomRecord,
  ): RoomSnapshot {
    this.cleanupSubscriptionsSync();
    this.leavingVoluntarily = false;
    this.activeCode = code;

    const { db } = getFirebaseServices();
    const initialSnapshot = parseRoomSnapshot(code, initialRaw, uid);
    this.currentSnapshot = initialSnapshot;

    this.detachPresence = attachRoomPresence(db, code, uid, isHost, () => {
      return this.currentSnapshot?.status ?? 'lobby';
    });

    const roomRef = ref(db, `rooms/${code}`);
    this.roomUnsubscribe = onValue(roomRef, (dataSnap) => {
      if (this.leavingVoluntarily || this.activeCode !== code) {
        return;
      }

      if (!dataSnap.exists()) {
        void this.handleRemoteRoomClosed('Der Raum wurde geschlossen.');
        return;
      }

      const raw = dataSnap.val() as RawRoomRecord;
      const nextSnap = parseRoomSnapshot(code, raw, uid);
      const prevStatus = this.currentSnapshot?.status ?? 'lobby';

      if (nextSnap.status === 'ended') {
        void this.handleRemoteRoomClosed(
          'Der Host hat das Spiel verlassen – Raum wurde geschlossen.',
        );
        return;
      }

      const hostPlayer = nextSnap.players.find((p) => p.uid === nextSnap.hostUid);
      if (!nextSnap.isHost && (!hostPlayer || !hostPlayer.online)) {
        void this.handleRemoteRoomClosed(
          'Der Host hat das Spiel verlassen – Raum wurde geschlossen.',
        );
        return;
      }

      this.currentSnapshot = nextSnap;
      if (prevStatus !== nextSnap.status && this.detachPresence) {
        void this.detachPresence.syncStatus(nextSnap.status);
      }

      this.emitRoomUpdate(nextSnap);
    });

    this.emitRoomUpdate(initialSnapshot);
    return initialSnapshot;
  }

  private async handleRemoteRoomClosed(reason: string): Promise<void> {
    const code = this.activeCode;
    const uid = this.uid;
    this.activeCode = null;
    this.currentSnapshot = null;

    const presence = this.detachPresence;
    this.detachPresence = null;
    if (this.roomUnsubscribe) {
      this.roomUnsubscribe();
      this.roomUnsubscribe = null;
    }
    if (presence) {
      await presence();
    }

    if (code && uid) {
      try {
        const { db } = getFirebaseServices();
        await remove(ref(db, `rooms/${code}/players/${uid}`));
      } catch {
        // Ignore cleanup permission/network race
      }
    }

    this.emitRoomUpdate(null);
    this.emitRoomClosed(reason);
  }

  private cleanupSubscriptionsSync(): void {
    if (this.roomUnsubscribe) {
      this.roomUnsubscribe();
      this.roomUnsubscribe = null;
    }
    if (this.detachPresence) {
      const detach = this.detachPresence;
      this.detachPresence = null;
      void detach();
    }
  }

  private requireActiveContext(): { code: string; uid: string; snap: RoomSnapshot } {
    if (!this.activeCode || !this.uid || !this.currentSnapshot) {
      throw new LobbyError('Du befindest dich aktuell in keinem Raum.', 'NOT_IN_ROOM');
    }
    return { code: this.activeCode, uid: this.uid, snap: this.currentSnapshot };
  }

  public async setTeam(team: TeamId): Promise<void> {
    const { code, uid, snap } = this.requireActiveContext();
    const selfPlayer = snap.players.find((p) => p.uid === uid);
    if (!selfPlayer) {
      throw new LobbyError('Spielereintrag im Raum nicht gefunden.', 'NOT_IN_ROOM');
    }
    if (selfPlayer.team === team) return;

    const targetTeamOnlineCount = snap.players.filter(
      (p) => p.uid !== uid && p.online && p.team === team,
    ).length;
    if (targetTeamOnlineCount >= snap.settings.teamSize) {
      throw new LobbyError('Dieses Team ist bereits voll.', 'TEAM_FULL');
    }

    const { db } = getFirebaseServices();
    await update(ref(db, `rooms/${code}/players/${uid}`), {
      team,
      ready: snap.isHost ? true : false,
    });
    await set(ref(db, `rooms/${code}/lastActive`), Date.now());
  }

  public async setCharacter(character: CharacterId): Promise<void> {
    if (!isValidCharacterId(character)) {
      throw new LobbyError('Ungültiger Charakter ausgewählt.', 'INVALID_CHARACTER');
    }
    const { code, uid } = this.requireActiveContext();
    const { db } = getFirebaseServices();
    await update(ref(db, `rooms/${code}/players/${uid}`), { character });
    await set(ref(db, `rooms/${code}/lastActive`), Date.now());
  }

  public async setReady(ready: boolean): Promise<void> {
    const { code, uid } = this.requireActiveContext();
    const { db } = getFirebaseServices();
    await update(ref(db, `rooms/${code}/players/${uid}`), { ready: Boolean(ready) });
    await set(ref(db, `rooms/${code}/lastActive`), Date.now());
  }

  public async updateSettings(partial: Partial<RoomSettings>): Promise<void> {
    const { code, snap } = this.requireActiveContext();
    if (!snap.isHost) {
      throw new LobbyError('Nur der Host kann Raum-Einstellungen ändern.', 'NOT_HOST');
    }

    const nextSettings = sanitizeRoomSettings(partial, snap.settings);
    const { db } = getFirebaseServices();
    await set(ref(db, `rooms/${code}/settings`), nextSettings);
    await set(ref(db, `rooms/${code}/lastActive`), Date.now());
  }

  public async startMatch(): Promise<void> {
    const { code, snap } = this.requireActiveContext();
    if (!snap.isHost) {
      throw new LobbyError('Nur der Host kann das Match starten.', 'NOT_HOST');
    }

    const { db } = getFirebaseServices();
    const initialMatch: RoomMatchSummary = {
      round: 1,
      scoreA: 0,
      scoreB: 0,
      phase: 'buy',
    };

    await set(ref(db, `rooms/${code}/match`), initialMatch);
    await set(ref(db, `rooms/${code}/status`), 'playing');
    await set(ref(db, `rooms/${code}/lastActive`), Date.now());

    if (this.detachPresence) {
      await this.detachPresence.syncStatus('playing');
    }
  }

  public async leaveRoom(): Promise<void> {
    const code = this.activeCode;
    const uid = this.uid;
    const wasHost = this.currentSnapshot?.isHost ?? false;

    this.leavingVoluntarily = true;
    this.activeCode = null;
    this.currentSnapshot = null;

    if (this.roomUnsubscribe) {
      this.roomUnsubscribe();
      this.roomUnsubscribe = null;
    }

    const presence = this.detachPresence;
    this.detachPresence = null;
    if (presence) {
      await presence();
    }

    if (code && uid) {
      try {
        const { db } = getFirebaseServices();
        if (wasHost) {
          await set(ref(db, `rooms/${code}/status`), 'ended').catch(() => {});
        }
        await remove(ref(db, `rooms/${code}/players/${uid}`)).catch(() => {});
      } catch {
        // Ignore network errors while leaving
      }
    }

    this.leavingVoluntarily = false;
    this.emitRoomUpdate(null);
  }
}
