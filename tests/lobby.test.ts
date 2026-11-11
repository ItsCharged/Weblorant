import { describe, expect, it } from 'vitest';
import databaseRules from '../database.rules.json';
import { mulberry32 } from '../src/core/math';
import type { LobbyPlayer } from '../src/core/types';
import { CHARACTER_IDS, CHARACTERS } from '../src/data/characters';
import {
  generateRoomCode,
  isRoomStaleOrOrphaned,
  isValidPlayerName,
  isValidRoomCode,
  normalizeRoomCode,
  pickBalancedTeam,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  STALE_ROOM_MS,
  sanitizePlayerName,
} from '../src/firebase/roomCode';

function makePlayer(
  uid: string,
  team: 'A' | 'D',
  online = true,
): LobbyPlayer {
  return {
    uid,
    name: `P-${uid}`,
    team,
    character: 'ryo',
    ready: true,
    online,
  };
}

describe('Phase 2 – Room Codes, Player Names, Lobby Balancing & RTDB Security Rules', () => {
  it('generates 500 5-character uppercase room codes that never contain 0, O, 1, or I', () => {
    expect(ROOM_CODE_ALPHABET.length).toBe(32);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[0O1I]/);

    const rng = mulberry32(0x1234abcd);
    for (let i = 0; i < 500; i += 1) {
      const code = generateRoomCode(rng);
      expect(code.length).toBe(ROOM_CODE_LENGTH);
      expect(code).toBe(code.toUpperCase());
      expect(code).not.toMatch(/[0O1I]/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('normalizes room codes and strictly rejects ambiguous chars, wrong lengths, and lowercase before normalize', () => {
    expect(isValidRoomCode('k7m4p')).toBe(false);
    expect(normalizeRoomCode(' k7m-4p ')).toBe('K7M4P');
    expect(isValidRoomCode(normalizeRoomCode(' k7m-4p '))).toBe(true);

    // Ambiguous characters rejected even after normalization
    expect(isValidRoomCode('AB0DE')).toBe(false);
    expect(isValidRoomCode('ABODE')).toBe(false);
    expect(isValidRoomCode('AB1DE')).toBe(false);
    expect(isValidRoomCode('ABIDE')).toBe(false);

    // Invalid lengths rejected
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('ABCD')).toBe(false);
    expect(isValidRoomCode('ABCDEF')).toBe(false);
  });

  it('sanitizes and validates player display names (1..16 trimmed printable chars)', () => {
    expect(sanitizePlayerName('   Ryo   Kade  ')).toBe('Ryo Kade');
    expect(sanitizePlayerName('NameMitMehrAlsSechzehnZeichen')).toHaveLength(16);
    expect(sanitizePlayerName('Test\n\tSpieler')).toBe('Test Spieler');

    expect(isValidPlayerName('Mira')).toBe(true);
    expect(isValidPlayerName('  Tessa Vahl  ')).toBe(true);
    expect(isValidPlayerName('1234567890123456')).toBe(true);

    expect(isValidPlayerName('')).toBe(false);
    expect(isValidPlayerName('     ')).toBe(false);
    expect(isValidPlayerName('12345678901234567')).toBe(false);
    expect(isValidPlayerName('Bad\u0007Name')).toBe(false);
  });

  it('detects stale (>30 min), ended, missing, and host-orphaned rooms accurately', () => {
    const now = 1_700_000_000_000;

    expect(isRoomStaleOrOrphaned(null, now)).toBe(true);

    const freshRoom = {
      status: 'lobby',
      createdAt: now - 10_000,
      lastActive: now - 2_000,
      hostUid: 'host-1',
      players: {
        'host-1': { online: true },
      },
    };
    expect(isRoomStaleOrOrphaned(freshRoom, now)).toBe(false);

    // Ended status
    expect(isRoomStaleOrOrphaned({ ...freshRoom, status: 'ended' }, now)).toBe(true);

    // Idle > 30 minutes
    expect(
      isRoomStaleOrOrphaned(
        { ...freshRoom, lastActive: now - STALE_ROOM_MS - 1_000 },
        now,
      ),
    ).toBe(true);

    // Offline host in lobby
    expect(
      isRoomStaleOrOrphaned(
        {
          ...freshRoom,
          players: { 'host-1': { online: false }, 'guest-1': { online: true } },
        },
        now,
      ),
    ).toBe(true);

    // Missing host in lobby
    expect(
      isRoomStaleOrOrphaned(
        {
          ...freshRoom,
          players: { 'guest-1': { online: true } },
        },
        now,
      ),
    ).toBe(true);
  });

  it('balances teams A and D up to teamSize * 2 and returns null when full', () => {
    const teamSize = 3;

    // Empty room -> tie defaults to 'A'
    expect(pickBalancedTeam([], teamSize)).toBe('A');

    // 1 in A -> picks 'D'
    const p1 = [makePlayer('u1', 'A')];
    expect(pickBalancedTeam(p1, teamSize)).toBe('D');

    // 1 in A, 1 in D -> tie picks 'A'
    const p2 = [...p1, makePlayer('u2', 'D')];
    expect(pickBalancedTeam(p2, teamSize)).toBe('A');

    // 3 in A, 1 in D -> A is at capacity, picks 'D'
    const p4 = [
      makePlayer('u1', 'A'),
      makePlayer('u2', 'A'),
      makePlayer('u3', 'A'),
      makePlayer('u4', 'D'),
    ];
    expect(pickBalancedTeam(p4, teamSize)).toBe('D');

    // 3 in A, 3 in D (6 online = teamSize * 2) -> full -> null
    const p6 = [
      ...p4,
      makePlayer('u5', 'D'),
      makePlayer('u6', 'D'),
    ];
    expect(pickBalancedTeam(p6, teamSize)).toBeNull();

    // Offline ghost slot does not block joining when < 10 records
    const withOffline = [
      ...p4,
      makePlayer('u5', 'D'),
      makePlayer('u6', 'D', false),
    ];
    expect(pickBalancedTeam(withOffline, teamSize)).toBe('D');
  });

  it('enforces strict least-privilege RTDB security rules in database.rules.json', () => {
    const rootRules = databaseRules.rules;
    expect(rootRules['.read']).toBe(false);
    expect(rootRules['.write']).toBe(false);

    const roomNode = rootRules.rooms.$code;
    expect(roomNode['.read']).toBe('auth != null');
    expect(roomNode['.validate']).toContain('$code.length === 5');

    // Each player can ONLY write their own players/$uid node
    const playerNode = roomNode.players.$uid;
    expect(playerNode['.write']).toContain('auth != null');
    expect(playerNode['.write']).toContain('auth.uid === $uid');
    expect(playerNode['.validate']).toContain("newData.child('name').val().length <= 16");
    expect(playerNode['.validate']).toContain("newData.child('team').val() === 'A'");
    expect(playerNode['.validate']).toContain("newData.child('team').val() === 'D'");

    for (const charId of CHARACTER_IDS) {
      expect(CHARACTERS[charId]).toBeDefined();
      expect(playerNode['.validate']).toContain(`'${charId}'`);
    }

    // Match, status, and settings strictly enforce hostUid ownership and <= 5v5 (max 10 players)
    expect(roomNode.status['.write']).toContain('hostUid');
    expect(roomNode.match['.write']).toContain('hostUid');
    expect(roomNode.settings['.write']).toContain('hostUid');
    expect(roomNode.settings['.validate']).toContain("newData.child('teamSize').val() <= 5");
  });
});
