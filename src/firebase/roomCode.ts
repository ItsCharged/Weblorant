import { clamp } from '../core/math';
import type { LobbyPlayer, TeamId } from '../core/types';

/**
 * 32 unambiguous uppercase characters — strictly excludes `0`, `O`, `1`, and `I`.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const STALE_ROOM_MS = 30 * 60 * 1000;
export const MAX_PLAYER_NAME_LENGTH = 16;

const VALID_ROOM_CODE_CHARS = new Set<string>(ROOM_CODE_ALPHABET.split(''));

export interface RawRoomLivenessView {
  status?: string;
  createdAt?: number;
  lastActive?: number;
  hostUid?: string;
  players?: Record<string, { online?: boolean } | undefined>;
}

/**
 * Generates a 5-character room code using only unambiguous uppercase alphanumeric characters.
 */
export function generateRoomCode(randomFn: () => number = Math.random): string {
  const len = ROOM_CODE_ALPHABET.length;
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const r = clamp(randomFn(), 0, 0.999999999);
    const idx = Math.floor(r * len) % len;
    code += ROOM_CODE_ALPHABET[idx];
  }
  return code;
}

/**
 * Uppercases raw user input and strips spaces and hyphens.
 */
export function normalizeRoomCode(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * Validates that `code` is already normalized to exact 5 characters from `ROOM_CODE_ALPHABET`.
 * Rejects lowercase characters, `0`, `O`, `1`, `I`, and invalid lengths.
 */
export function isValidRoomCode(code: string): boolean {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) {
    return false;
  }
  for (let i = 0; i < code.length; i += 1) {
    if (!VALID_ROOM_CODE_CHARS.has(code[i])) {
      return false;
    }
  }
  return true;
}

/**
 * Strips control characters, collapses repeated whitespace, trims, and truncates to max 16 chars.
 */
export function sanitizePlayerName(raw: string): string {
  if (typeof raw !== 'string') return '';
  const withoutControls = raw.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ');
  const collapsed = withoutControls.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, MAX_PLAYER_NAME_LENGTH).trim();
}

/**
 * Checks whether a display name has 1..16 trimmed printable characters.
 */
export function isValidPlayerName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (/[\u0000-\u001F\u007F-\u009F]/.test(name)) return false;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_PLAYER_NAME_LENGTH;
}

/**
 * Determines whether a Realtime Database room record is missing, ended, idle > 30 minutes,
 * or orphaned by an offline/missing host while still in the lobby.
 */
export function isRoomStaleOrOrphaned(
  room: RawRoomLivenessView | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!room) return true;
  if (room.status === 'ended') return true;
  if (!room.hostUid || typeof room.hostUid !== 'string') return true;

  const lastTimestamp = room.lastActive ?? room.createdAt ?? 0;
  if (lastTimestamp <= 0 || nowMs - lastTimestamp > STALE_ROOM_MS) {
    return true;
  }

  const players = room.players ?? {};
  const hostEntry = players[room.hostUid];

  if (!room.status || room.status === 'lobby') {
    if (!hostEntry || hostEntry.online === false) {
      return true;
    }
  } else {
    const anyOnline = Object.values(players).some((p) => p && p.online !== false);
    if (!anyOnline) {
      return true;
    }
  }

  return false;
}

/**
 * Picks the smaller team (`'A'` on ties) among online players, or returns `null` if the room is full.
 */
export function pickBalancedTeam(
  players: ReadonlyArray<LobbyPlayer>,
  teamSize: number,
): TeamId | null {
  const clampedSize = Math.max(1, Math.min(5, Math.floor(teamSize)));
  const maxTotal = Math.min(10, clampedSize * 2);

  if (players.length >= 10) {
    return null;
  }

  const onlinePlayers = players.filter((p) => p.online !== false);
  if (onlinePlayers.length >= maxTotal) {
    return null;
  }

  let countA = 0;
  let countD = 0;
  for (const p of onlinePlayers) {
    if (p.team === 'A') countA += 1;
    else if (p.team === 'D') countD += 1;
  }

  if (countA >= clampedSize && countD >= clampedSize) {
    return null;
  }
  if (countA >= clampedSize) {
    return 'D';
  }
  if (countD >= clampedSize) {
    return 'A';
  }

  return countA <= countD ? 'A' : 'D';
}
