import type {
  AbilitySlot,
  ActiveWorldEffect,
  BuyItemType,
  CharacterId,
  ClientInputPacket,
  ClientReliableMessage,
  HitZone,
  KernSnapshot,
  KernStatus,
  LoadoutSlot,
  MatchPhase,
  NetGameEvent,
  NetPlayerState,
  PlayerAbilityState,
  PlayerStance,
  RoundStateSnapshot,
  RoundWinReason,
  TeamId,
  WeaponId,
  WorldEffectKind,
  WorldSnapshot,
} from '../core/types';

const WEAPON_TABLE: readonly WeaponId[] = [
  'funke',
  'bolzer',
  'hornisse',
  'brecher',
  'lanze',
  'falke',
];

const CHARACTER_TABLE: readonly CharacterId[] = ['ryo', 'mira', 'brann', 'tessa'];

const STANCE_TABLE: readonly PlayerStance[] = ['stand', 'walk', 'crouch', 'air'];

const HITZONE_TABLE: readonly HitZone[] = ['head', 'body', 'world', 'button', 'none'];

const MATCH_PHASE_TABLE: readonly MatchPhase[] = [
  'buy',
  'action',
  'planted',
  'post_round',
  'ended',
];

const KERN_STATUS_TABLE: readonly KernStatus[] = [
  'carried',
  'dropped',
  'planting',
  'planted',
  'defusing',
  'detonated',
  'defused',
];

const WIN_REASON_TABLE: readonly RoundWinReason[] = [
  'kern_detonated',
  'defenders_eliminated',
  'kern_defused',
  'attackers_eliminated',
  'time_expired',
];

const WORLD_EFFECT_TABLE: readonly WorldEffectKind[] = [
  'dash_trail',
  'echo_sensor',
  'jammer_field',
  'global_reveal',
  'smoke_dome',
  'ember_field',
  'dark_ring',
  'magnet_mine',
  'shield_post',
  'bastion_zone',
];

type KernEventAction = Extract<NetGameEvent, { type: 'kern_event' }>['action'];

const KERN_ACTION_TABLE: readonly KernEventAction[] = [
  'picked_up',
  'dropped',
  'plant_start',
  'planted',
  'defuse_start',
  'half_defused',
  'defused',
  'detonated',
];

const BUY_ITEM_TYPES: readonly BuyItemType[] = [
  'weapon',
  'armor',
  'ability_q',
  'ability_e',
];

const FLAG_JUMP = 1 << 0;
const FLAG_CROUCH = 1 << 1;
const FLAG_WALK = 1 << 2;
const FLAG_FIRE = 1 << 3;
const FLAG_ADS = 1 << 4;
const FLAG_RELOAD = 1 << 5;
const FLAG_HOLD_KERN = 1 << 6;

const RFLAG_BARRIERS = 1 << 0;
const RFLAG_SWAPPED = 1 << 1;
const RFLAG_SUDDEN_DEATH = 1 << 2;

const EFLAG_ARMED_TRUE = 1 << 0;
const EFLAG_ARMED_FALSE = 1 << 1;
const EFLAG_TRIG_TRUE = 1 << 2;
const EFLAG_TRIG_FALSE = 1 << 3;

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

export function round3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function weaponToIdx(id: WeaponId | null | undefined): number {
  if (!id) return -1;
  return WEAPON_TABLE.indexOf(id);
}

function idxToWeapon(idx: unknown, fallback: WeaponId = 'lanze'): WeaponId {
  if (typeof idx === 'number' && idx >= 0 && idx < WEAPON_TABLE.length) {
    return WEAPON_TABLE[Math.trunc(idx)];
  }
  return fallback;
}

function idxToNullableWeapon(idx: unknown): WeaponId | null {
  if (typeof idx === 'number' && idx >= 0 && idx < WEAPON_TABLE.length) {
    return WEAPON_TABLE[Math.trunc(idx)];
  }
  return null;
}

function charToIdx(id: CharacterId): number {
  const idx = CHARACTER_TABLE.indexOf(id);
  return idx >= 0 ? idx : 0;
}

function idxToChar(idx: unknown): CharacterId {
  if (typeof idx === 'number' && idx >= 0 && idx < CHARACTER_TABLE.length) {
    return CHARACTER_TABLE[Math.trunc(idx)];
  }
  return 'ryo';
}

function stanceToIdx(stance: PlayerStance): number {
  const idx = STANCE_TABLE.indexOf(stance);
  return idx >= 0 ? idx : 0;
}

function idxToStance(idx: unknown): PlayerStance {
  if (typeof idx === 'number' && idx >= 0 && idx < STANCE_TABLE.length) {
    return STANCE_TABLE[Math.trunc(idx)];
  }
  return 'stand';
}

function hitZoneToIdx(hz: HitZone): number {
  const idx = HITZONE_TABLE.indexOf(hz);
  return idx >= 0 ? idx : 4;
}

function idxToHitZone(idx: unknown): HitZone {
  if (typeof idx === 'number' && idx >= 0 && idx < HITZONE_TABLE.length) {
    return HITZONE_TABLE[Math.trunc(idx)];
  }
  return 'none';
}

function phaseToIdx(phase: MatchPhase): number {
  const idx = MATCH_PHASE_TABLE.indexOf(phase);
  return idx >= 0 ? idx : 0;
}

function idxToPhase(idx: unknown): MatchPhase {
  if (typeof idx === 'number' && idx >= 0 && idx < MATCH_PHASE_TABLE.length) {
    return MATCH_PHASE_TABLE[Math.trunc(idx)];
  }
  return 'buy';
}

function kernStatusToIdx(status: KernStatus): number {
  const idx = KERN_STATUS_TABLE.indexOf(status);
  return idx >= 0 ? idx : 0;
}

function idxToKernStatus(idx: unknown): KernStatus {
  if (typeof idx === 'number' && idx >= 0 && idx < KERN_STATUS_TABLE.length) {
    return KERN_STATUS_TABLE[Math.trunc(idx)];
  }
  return 'carried';
}

function winReasonToIdx(reason: RoundWinReason | undefined): number {
  if (!reason) return -1;
  return WIN_REASON_TABLE.indexOf(reason);
}

function idxToWinReason(idx: unknown): RoundWinReason | undefined {
  if (typeof idx === 'number' && idx >= 0 && idx < WIN_REASON_TABLE.length) {
    return WIN_REASON_TABLE[Math.trunc(idx)];
  }
  return undefined;
}

function effectKindToIdx(kind: WorldEffectKind): number {
  const idx = WORLD_EFFECT_TABLE.indexOf(kind);
  return idx >= 0 ? idx : 0;
}

function idxToEffectKind(idx: unknown): WorldEffectKind {
  if (typeof idx === 'number' && idx >= 0 && idx < WORLD_EFFECT_TABLE.length) {
    return WORLD_EFFECT_TABLE[Math.trunc(idx)];
  }
  return 'smoke_dome';
}

function activeBuffToIdx(buff: PlayerAbilityState['activeBuff']): number {
  if (buff === 'adrenalin') return 1;
  if (buff === 'ueberlast') return 2;
  return 0;
}

function idxToActiveBuff(idx: unknown): PlayerAbilityState['activeBuff'] {
  if (idx === 1) return 'adrenalin';
  if (idx === 2) return 'ueberlast';
  return null;
}

function teamToCode(team: TeamId | null | undefined): number {
  if (team === 'A') return 1;
  if (team === 'D') return 2;
  return 0;
}

function codeToTeam(code: unknown): TeamId | undefined {
  if (code === 1) return 'A';
  if (code === 2) return 'D';
  return undefined;
}

function toLoadoutSlot(val: unknown, fallback: LoadoutSlot = 1): LoadoutSlot {
  if (val === 1 || val === 2 || val === 3) {
    return val;
  }
  return fallback;
}

function isAbilitySlot(val: unknown): val is AbilitySlot {
  return val === 'q' || val === 'e' || val === 'x';
}

export const MAX_CHAT_TEXT_LENGTH = 140;
export const MAX_CHAT_SENDER_LENGTH = 32;

/**
 * Strips ASCII/C1 control characters, normalizes line breaks/tabs to spaces,
 * trims outer whitespace, and caps length (pure function, zero DOM imports).
 */
export function sanitizeChatText(
  raw: string,
  maxLen: number = MAX_CHAT_TEXT_LENGTH,
): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Fast inspection of the leading state tuple tag ('i', 's', 'p', 'q') without full parse.
 */
export function peekStateFrameTag(raw: string): 'i' | 's' | 'p' | 'q' | null {
  if (typeof raw !== 'string' || raw.length < 5 || raw.charCodeAt(0) !== 91) {
    return null;
  }
  if (raw.charCodeAt(1) === 34 && raw.charCodeAt(3) === 34) {
    const ch = raw.charAt(2);
    if (ch === 'i' || ch === 's' || ch === 'p' || ch === 'q') {
      return ch;
    }
  }
  return null;
}

/**
 * Distinguishes reliable Client->Host messages (`['c', ...]`) from NetGameEvent frames.
 */
export function isClientMessageFrame(raw: string): boolean {
  return typeof raw === 'string' && raw.length >= 6 && raw.startsWith('["c",');
}

export function encodeInput(pkt: ClientInputPacket): string {
  const flags =
    (pkt.jump ? FLAG_JUMP : 0) |
    (pkt.crouch ? FLAG_CROUCH : 0) |
    (pkt.walk ? FLAG_WALK : 0) |
    (pkt.fire ? FLAG_FIRE : 0) |
    (pkt.ads ? FLAG_ADS : 0) |
    (pkt.reload ? FLAG_RELOAD : 0) |
    (pkt.holdKern ? FLAG_HOLD_KERN : 0);

  const equipSlotNum =
    pkt.equipSlot === 1 || pkt.equipSlot === 2 || pkt.equipSlot === 3
      ? pkt.equipSlot
      : 0;

  const frame = [
    'i',
    Math.trunc(pkt.seq),
    round2(pkt.clientTimeMs),
    round2(pkt.forward),
    round2(pkt.right),
    flags,
    weaponToIdx(pkt.weaponSlot),
    round3(pkt.yaw),
    round3(pkt.pitch),
    equipSlotNum,
  ];
  return JSON.stringify(frame);
}

export function decodeInput(raw: string): ClientInputPacket | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 9 || parsed[0] !== 'i') {
      return null;
    }
    const seq = parsed[1];
    const clientTimeMs = parsed[2];
    const forward = parsed[3];
    const right = parsed[4];
    const flags = parsed[5];
    const weaponIdx = parsed[6];
    const yaw = parsed[7];
    const pitch = parsed[8];

    if (
      !isFiniteNum(seq) ||
      !isFiniteNum(clientTimeMs) ||
      !isFiniteNum(forward) ||
      !isFiniteNum(right) ||
      !isFiniteNum(flags) ||
      !isFiniteNum(weaponIdx) ||
      !isFiniteNum(yaw) ||
      !isFiniteNum(pitch)
    ) {
      return null;
    }

    const mask = Math.trunc(flags);
    const pkt: ClientInputPacket = {
      seq: Math.trunc(seq),
      clientTimeMs,
      forward,
      right,
      jump: (mask & FLAG_JUMP) !== 0,
      crouch: (mask & FLAG_CROUCH) !== 0,
      walk: (mask & FLAG_WALK) !== 0,
      fire: (mask & FLAG_FIRE) !== 0,
      ads: (mask & FLAG_ADS) !== 0,
      reload: (mask & FLAG_RELOAD) !== 0,
      holdKern: (mask & FLAG_HOLD_KERN) !== 0,
      yaw,
      pitch,
    };

    if (weaponIdx >= 0 && weaponIdx < WEAPON_TABLE.length) {
      pkt.weaponSlot = WEAPON_TABLE[Math.trunc(weaponIdx)];
    }

    if (parsed.length >= 10) {
      const slotRaw = parsed[9];
      if (slotRaw === 1 || slotRaw === 2 || slotRaw === 3) {
        pkt.equipSlot = slotRaw;
      }
    }

    return pkt;
  } catch {
    return null;
  }
}

function encodePlayerAbilities(ab: PlayerAbilityState): unknown[] {
  return [
    Math.trunc(ab.qCharges),
    Math.trunc(ab.qMax),
    Math.trunc(ab.eCharges),
    Math.trunc(ab.eMax),
    Math.trunc(ab.ultPoints),
    Math.trunc(ab.ultMax),
    activeBuffToIdx(ab.activeBuff),
    round2(ab.buffRemainingSec),
    round2(ab.weaponLockoutSec),
    round2(ab.slowedSec),
    round2(ab.revealedSec),
    teamToCode(ab.revealedToTeam),
    ab.bastionProtected ? 1 : 0,
  ];
}

function decodePlayerAbilities(raw: unknown): PlayerAbilityState | undefined {
  if (!Array.isArray(raw) || raw.length < 13) {
    return undefined;
  }
  if (
    !isFiniteNum(raw[0]) ||
    !isFiniteNum(raw[1]) ||
    !isFiniteNum(raw[2]) ||
    !isFiniteNum(raw[3]) ||
    !isFiniteNum(raw[4]) ||
    !isFiniteNum(raw[5]) ||
    !isFiniteNum(raw[7]) ||
    !isFiniteNum(raw[8]) ||
    !isFiniteNum(raw[9]) ||
    !isFiniteNum(raw[10])
  ) {
    return undefined;
  }

  return {
    qCharges: Math.trunc(raw[0]),
    qMax: Math.trunc(raw[1]),
    eCharges: Math.trunc(raw[2]),
    eMax: Math.trunc(raw[3]),
    ultPoints: Math.trunc(raw[4]),
    ultMax: Math.trunc(raw[5]),
    activeBuff: idxToActiveBuff(raw[6]),
    buffRemainingSec: raw[7],
    weaponLockoutSec: raw[8],
    slowedSec: raw[9],
    revealedSec: raw[10],
    revealedToTeam: codeToTeam(raw[11]) ?? null,
    bastionProtected: raw[12] === 1,
  };
}

function encodeWorldEffect(eff: ActiveWorldEffect): unknown[] {
  const eFlags =
    (eff.armed === undefined ? 0 : eff.armed ? EFLAG_ARMED_TRUE : EFLAG_ARMED_FALSE) |
    (eff.triggered === undefined ? 0 : eff.triggered ? EFLAG_TRIG_TRUE : EFLAG_TRIG_FALSE);

  return [
    eff.id,
    effectKindToIdx(eff.kind),
    eff.ownerUid,
    eff.team,
    round2(eff.pos.x),
    round2(eff.pos.y),
    round2(eff.pos.z),
    round3(eff.yaw),
    round2(eff.radius),
    eff.innerRadius !== undefined ? round2(eff.innerRadius) : -1,
    eff.height !== undefined ? round2(eff.height) : -1,
    round2(eff.remainingSec),
    round2(eff.totalSec),
    eff.hp !== undefined ? Math.round(eff.hp) : -1,
    eff.maxHp !== undefined ? Math.round(eff.maxHp) : -1,
    eFlags,
  ];
}

function decodeWorldEffects(raw: unknown): ActiveWorldEffect[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const effects: ActiveWorldEffect[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 16) {
      continue;
    }
    const id = row[0];
    const ownerUid = row[2];
    const team = row[3];
    if (
      typeof id !== 'string' ||
      typeof ownerUid !== 'string' ||
      (team !== 'A' && team !== 'D') ||
      !isFiniteNum(row[4]) ||
      !isFiniteNum(row[5]) ||
      !isFiniteNum(row[6]) ||
      !isFiniteNum(row[7]) ||
      !isFiniteNum(row[8]) ||
      !isFiniteNum(row[9]) ||
      !isFiniteNum(row[10]) ||
      !isFiniteNum(row[11]) ||
      !isFiniteNum(row[12]) ||
      !isFiniteNum(row[13]) ||
      !isFiniteNum(row[14]) ||
      !isFiniteNum(row[15])
    ) {
      continue;
    }

    const flags = Math.trunc(row[15]);
    const armed =
      (flags & EFLAG_ARMED_TRUE) !== 0
        ? true
        : (flags & EFLAG_ARMED_FALSE) !== 0
          ? false
          : undefined;
    const triggered =
      (flags & EFLAG_TRIG_TRUE) !== 0
        ? true
        : (flags & EFLAG_TRIG_FALSE) !== 0
          ? false
          : undefined;

    effects.push({
      id,
      kind: idxToEffectKind(row[1]),
      ownerUid,
      team,
      pos: { x: row[4], y: row[5], z: row[6] },
      yaw: row[7],
      radius: row[8],
      ...(row[9] >= 0 ? { innerRadius: row[9] } : {}),
      ...(row[10] >= 0 ? { height: row[10] } : {}),
      remainingSec: row[11],
      totalSec: row[12],
      ...(row[13] >= 0 ? { hp: row[13] } : {}),
      ...(row[14] >= 0 ? { maxHp: row[14] } : {}),
      ...(armed !== undefined ? { armed } : {}),
      ...(triggered !== undefined ? { triggered } : {}),
    });
  }
  return effects;
}

function encodeRoundSnapshot(round: RoundStateSnapshot): unknown[] {
  const rFlags =
    (round.barriersActive ? RFLAG_BARRIERS : 0) |
    (round.sidesSwapped ? RFLAG_SWAPPED : 0) |
    (round.isSuddenDeath ? RFLAG_SUDDEN_DEATH : 0);

  const k = round.kern;
  const kernTuple = [
    kernStatusToIdx(k.status),
    round2(k.pos.x),
    round2(k.pos.y),
    round2(k.pos.z),
    k.carrierUid ?? '',
    k.plantedZone ?? '',
    k.actorUid ?? '',
    round2(k.progress01),
    k.halfDefused ? 1 : 0,
    round2(k.fuseRemainingSec),
  ];

  return [
    Math.trunc(round.roundNumber),
    Math.trunc(round.scoreA),
    Math.trunc(round.scoreB),
    phaseToIdx(round.phase),
    round2(round.phaseRemainingSec),
    rFlags,
    teamToCode(round.winnerTeam),
    winReasonToIdx(round.winReason),
    teamToCode(round.matchWinnerTeam),
    kernTuple,
  ];
}

function decodeRoundSnapshot(raw: unknown): RoundStateSnapshot | undefined {
  if (!Array.isArray(raw) || raw.length < 10) {
    return undefined;
  }
  if (
    !isFiniteNum(raw[0]) ||
    !isFiniteNum(raw[1]) ||
    !isFiniteNum(raw[2]) ||
    !isFiniteNum(raw[4]) ||
    !isFiniteNum(raw[5]) ||
    !Array.isArray(raw[9])
  ) {
    return undefined;
  }

  const kt = raw[9];
  if (
    kt.length < 10 ||
    !isFiniteNum(kt[1]) ||
    !isFiniteNum(kt[2]) ||
    !isFiniteNum(kt[3]) ||
    !isFiniteNum(kt[7]) ||
    !isFiniteNum(kt[9])
  ) {
    return undefined;
  }

  const carrierUid = typeof kt[4] === 'string' && kt[4].length > 0 ? kt[4] : undefined;
  const plantedZone = kt[5] === 'A' || kt[5] === 'B' ? kt[5] : undefined;
  const actorUid = typeof kt[6] === 'string' && kt[6].length > 0 ? kt[6] : undefined;

  const kern: KernSnapshot = {
    status: idxToKernStatus(kt[0]),
    pos: { x: kt[1], y: kt[2], z: kt[3] },
    ...(carrierUid ? { carrierUid } : {}),
    ...(plantedZone ? { plantedZone } : {}),
    ...(actorUid ? { actorUid } : {}),
    progress01: kt[7],
    halfDefused: kt[8] === 1,
    fuseRemainingSec: kt[9],
  };

  const rFlags = Math.trunc(raw[5]);
  const winnerTeam = codeToTeam(raw[6]);
  const winReason = idxToWinReason(raw[7]);
  const matchWinnerTeam = codeToTeam(raw[8]);

  return {
    roundNumber: Math.trunc(raw[0]),
    scoreA: Math.trunc(raw[1]),
    scoreB: Math.trunc(raw[2]),
    phase: idxToPhase(raw[3]),
    phaseRemainingSec: raw[4],
    barriersActive: (rFlags & RFLAG_BARRIERS) !== 0,
    sidesSwapped: (rFlags & RFLAG_SWAPPED) !== 0,
    isSuddenDeath: (rFlags & RFLAG_SUDDEN_DEATH) !== 0,
    ...(winnerTeam ? { winnerTeam } : {}),
    ...(winReason ? { winReason } : {}),
    ...(matchWinnerTeam ? { matchWinnerTeam } : {}),
    kern,
  };
}

export function encodeSnapshot(snap: WorldSnapshot): string {
  const playersTuple = snap.players.map((p) => {
    const fallbackPrimary: WeaponId | null =
      p.primaryWeapon !== undefined
        ? p.primaryWeapon
        : p.weaponId !== 'funke' && p.weaponId !== 'bolzer'
          ? p.weaponId
          : null;
    const fallbackSecondary: WeaponId = p.secondaryWeapon ?? 'funke';
    const fallbackArmorMax =
      p.armorMax ?? (p.armor > 25 ? 50 : p.armor > 0 ? 25 : 0);

    const row: unknown[] = [
      p.uid,
      p.name,
      p.team,
      charToIdx(p.character),
      round2(p.pos.x),
      round2(p.pos.y),
      round2(p.pos.z),
      round2(p.vel.x),
      round2(p.vel.y),
      round2(p.vel.z),
      round3(p.yaw),
      round3(p.pitch),
      stanceToIdx(p.stance),
      Math.round(p.hp),
      Math.round(p.armor),
      p.alive ? 1 : 0,
      Math.max(0, weaponToIdx(p.weaponId)),
      Math.round(p.ammoInMag),
      p.isReloading ? 1 : 0,
      Math.round(p.kills),
      Math.round(p.deaths),
      Math.trunc(p.lastAckSeq),
      Math.round(p.credits ?? 800),
      Math.round(fallbackArmorMax),
      weaponToIdx(fallbackPrimary),
      Math.max(0, weaponToIdx(fallbackSecondary)),
      toLoadoutSlot(p.activeSlot, 1),
      p.hasKern ? 1 : 0,
      Math.round(p.assists ?? 0),
      Math.round(p.plants ?? 0),
      Math.round(p.defuses ?? 0),
      Math.round(p.ultPoints ?? 0),
    ];

    if (p.abilities) {
      row.push(encodePlayerAbilities(p.abilities));
    }

    return row;
  });

  const outer: unknown[] = [
    's',
    Math.trunc(snap.tick),
    round2(snap.serverTimeMs),
    playersTuple,
  ];
  if (snap.round !== undefined || snap.effects !== undefined) {
    outer.push(snap.round ? encodeRoundSnapshot(snap.round) : null);
    if (snap.effects !== undefined) {
      outer.push(snap.effects.map(encodeWorldEffect));
    }
  }

  return JSON.stringify(outer);
}

export function decodeSnapshot(raw: string): WorldSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 4 || parsed[0] !== 's') {
      return null;
    }
    const tick = parsed[1];
    const serverTimeMs = parsed[2];
    const rawPlayers = parsed[3];
    if (!isFiniteNum(tick) || !isFiniteNum(serverTimeMs) || !Array.isArray(rawPlayers)) {
      return null;
    }

    const players: NetPlayerState[] = [];
    for (const row of rawPlayers) {
      if (!Array.isArray(row) || row.length < 22) {
        continue;
      }
      const uid = row[0];
      const name = row[1];
      const team = row[2];
      if (typeof uid !== 'string' || typeof name !== 'string' || (team !== 'A' && team !== 'D')) {
        continue;
      }
      if (
        !isFiniteNum(row[4]) ||
        !isFiniteNum(row[5]) ||
        !isFiniteNum(row[6]) ||
        !isFiniteNum(row[7]) ||
        !isFiniteNum(row[8]) ||
        !isFiniteNum(row[9]) ||
        !isFiniteNum(row[10]) ||
        !isFiniteNum(row[11]) ||
        !isFiniteNum(row[13]) ||
        !isFiniteNum(row[14]) ||
        !isFiniteNum(row[17]) ||
        !isFiniteNum(row[19]) ||
        !isFiniteNum(row[20]) ||
        !isFiniteNum(row[21])
      ) {
        continue;
      }

      const weaponId = idxToWeapon(row[16]);
      const armor = row[14];
      const hasPhase4Cols = row.length >= 32;

      const credits = hasPhase4Cols && isFiniteNum(row[22]) ? row[22] : 800;
      const armorMax =
        hasPhase4Cols && isFiniteNum(row[23])
          ? row[23]
          : armor > 25
            ? 50
            : armor > 0
              ? 25
              : 0;
      const primaryWeapon = hasPhase4Cols
        ? idxToNullableWeapon(row[24])
        : weaponId !== 'funke' && weaponId !== 'bolzer'
          ? weaponId
          : null;
      const secondaryWeapon = hasPhase4Cols
        ? idxToWeapon(row[25], 'funke')
        : 'funke';
      const activeSlot = hasPhase4Cols ? toLoadoutSlot(row[26], 1) : 1;
      const hasKern = hasPhase4Cols ? row[27] === 1 : false;
      const assists = hasPhase4Cols && isFiniteNum(row[28]) ? row[28] : 0;
      const plants = hasPhase4Cols && isFiniteNum(row[29]) ? row[29] : 0;
      const defuses = hasPhase4Cols && isFiniteNum(row[30]) ? row[30] : 0;
      const ultPoints = hasPhase4Cols && isFiniteNum(row[31]) ? row[31] : 0;
      const abilities = row.length >= 33 ? decodePlayerAbilities(row[32]) : undefined;

      players.push({
        uid,
        name,
        team: team as TeamId,
        character: idxToChar(row[3]),
        pos: { x: row[4], y: row[5], z: row[6] },
        vel: { x: row[7], y: row[8], z: row[9] },
        yaw: row[10],
        pitch: row[11],
        stance: idxToStance(row[12]),
        hp: row[13],
        armor,
        armorMax,
        alive: row[15] === 1,
        weaponId,
        primaryWeapon,
        secondaryWeapon,
        activeSlot,
        ammoInMag: row[17],
        isReloading: row[18] === 1,
        hasKern,
        credits,
        kills: row[19],
        deaths: row[20],
        assists,
        plants,
        defuses,
        ultPoints,
        lastAckSeq: Math.trunc(row[21]),
        ...(abilities ? { abilities } : {}),
      });
    }

    const round = parsed.length >= 5 && parsed[4] != null ? decodeRoundSnapshot(parsed[4]) : undefined;
    const effects = parsed.length >= 6 ? decodeWorldEffects(parsed[5]) : undefined;

    return {
      tick: Math.trunc(tick),
      serverTimeMs,
      players,
      ...(round ? { round } : {}),
      ...(effects !== undefined ? { effects } : {}),
    };
  } catch {
    return null;
  }
}

export interface ControlFrame {
  kind: 'ping' | 'pong';
  pingId: number;
  t0: number;
}

export function encodePing(pingId: number, t0: number): string {
  return JSON.stringify(['p', Math.trunc(pingId), round2(t0)]);
}

export function encodePong(pingId: number, t0: number): string {
  return JSON.stringify(['q', Math.trunc(pingId), round2(t0)]);
}

export function decodeControlFrame(raw: string): ControlFrame | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 3) {
      return null;
    }
    const tag = parsed[0];
    const pingId = parsed[1];
    const t0 = parsed[2];
    if ((tag !== 'p' && tag !== 'q') || !isFiniteNum(pingId) || !isFiniteNum(t0)) {
      return null;
    }
    return {
      kind: tag === 'p' ? 'ping' : 'pong',
      pingId: Math.trunc(pingId),
      t0,
    };
  } catch {
    return null;
  }
}

export function encodeEvent(ev: NetGameEvent): string {
  switch (ev.type) {
    case 'shot':
      return JSON.stringify([
        'sh',
        ev.shooterUid,
        Math.max(0, weaponToIdx(ev.weaponId)),
        round2(ev.origin.x),
        round2(ev.origin.y),
        round2(ev.origin.z),
        round2(ev.hitPoint.x),
        round2(ev.hitPoint.y),
        round2(ev.hitPoint.z),
        hitZoneToIdx(ev.hitZone),
        ev.targetUid ?? '',
      ]);
    case 'damage':
      return JSON.stringify([
        'dm',
        ev.attackerUid,
        ev.victimUid,
        Math.round(ev.damage),
        ev.hitZone === 'head' ? 0 : 1,
        Math.round(ev.hpAfter),
        Math.round(ev.armorAfter),
        ev.killed ? 1 : 0,
        Math.max(0, weaponToIdx(ev.weaponId)),
      ]);
    case 'respawn':
      return JSON.stringify([
        'rs',
        ev.uid,
        round2(ev.pos.x),
        round2(ev.pos.y),
        round2(ev.pos.z),
        round3(ev.yaw),
      ]);
    case 'reload':
      return JSON.stringify(['rl', ev.uid, Math.max(0, weaponToIdx(ev.weaponId))]);
    case 'footstep':
      return JSON.stringify([
        'fs',
        ev.uid,
        round2(ev.pos.x),
        round2(ev.pos.y),
        round2(ev.pos.z),
      ]);
    case 'buy_result':
      return JSON.stringify([
        'br',
        ev.uid,
        ev.ok ? 1 : 0,
        ev.reason ?? '',
        Math.round(ev.credits),
        weaponToIdx(ev.weaponId),
        ev.armor !== undefined ? Math.round(ev.armor) : -1,
        ev.armorMax !== undefined ? Math.round(ev.armorMax) : -1,
      ]);
    case 'round_phase':
      return JSON.stringify([
        'rp',
        phaseToIdx(ev.phase),
        Math.trunc(ev.roundNumber),
        Math.trunc(ev.scoreA),
        Math.trunc(ev.scoreB),
        teamToCode(ev.winnerTeam),
        winReasonToIdx(ev.winReason),
        ev.sidesSwapped === undefined ? -1 : ev.sidesSwapped ? 1 : 0,
        ev.isSuddenDeath === undefined ? -1 : ev.isSuddenDeath ? 1 : 0,
        teamToCode(ev.matchWinnerTeam),
      ]);
    case 'kern_event': {
      const actionIdx = KERN_ACTION_TABLE.indexOf(ev.action);
      return JSON.stringify([
        'ke',
        actionIdx >= 0 ? actionIdx : 0,
        ev.uid ?? '',
        ev.zone ?? '',
        round2(ev.pos.x),
        round2(ev.pos.y),
        round2(ev.pos.z),
      ]);
    }
    case 'ability_cast':
      if (ev.targetPos) {
        return JSON.stringify([
          'ac',
          ev.uid,
          ev.team,
          charToIdx(ev.character),
          ev.slot,
          ev.abilityName,
          round2(ev.origin.x),
          round2(ev.origin.y),
          round2(ev.origin.z),
          round2(ev.targetPos.x),
          round2(ev.targetPos.y),
          round2(ev.targetPos.z),
        ]);
      }
      return JSON.stringify([
        'ac',
        ev.uid,
        ev.team,
        charToIdx(ev.character),
        ev.slot,
        ev.abilityName,
        round2(ev.origin.x),
        round2(ev.origin.y),
        round2(ev.origin.z),
      ]);
    case 'effect_event':
      return JSON.stringify([
        'ee',
        ev.effectId,
        effectKindToIdx(ev.kind),
        ev.action === 'triggered' ? 0 : 1,
        round2(ev.pos.x),
        round2(ev.pos.y),
        round2(ev.pos.z),
      ]);
    case 'chat':
      return JSON.stringify([
        'ct',
        ev.uid,
        sanitizeChatText(ev.senderName, MAX_CHAT_SENDER_LENGTH),
        ev.team,
        sanitizeChatText(ev.text, MAX_CHAT_TEXT_LENGTH),
        ev.teamOnly ? 1 : 0,
        Math.round(ev.timestampMs),
      ]);
  }
}

export function decodeEvent(raw: string): NetGameEvent | null {
  try {
    const p: unknown = JSON.parse(raw);
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'string') {
      return null;
    }
    switch (p[0]) {
      case 'sh': {
        if (
          p.length < 11 ||
          typeof p[1] !== 'string' ||
          !isFiniteNum(p[3]) ||
          !isFiniteNum(p[4]) ||
          !isFiniteNum(p[5]) ||
          !isFiniteNum(p[6]) ||
          !isFiniteNum(p[7]) ||
          !isFiniteNum(p[8])
        ) {
          return null;
        }
        const targetUid = typeof p[10] === 'string' && p[10].length > 0 ? p[10] : undefined;
        return {
          type: 'shot',
          shooterUid: p[1],
          weaponId: idxToWeapon(p[2]),
          origin: { x: p[3], y: p[4], z: p[5] },
          hitPoint: { x: p[6], y: p[7], z: p[8] },
          hitZone: idxToHitZone(p[9]),
          ...(targetUid ? { targetUid } : {}),
        };
      }
      case 'dm': {
        if (
          p.length < 9 ||
          typeof p[1] !== 'string' ||
          typeof p[2] !== 'string' ||
          !isFiniteNum(p[3]) ||
          !isFiniteNum(p[5]) ||
          !isFiniteNum(p[6])
        ) {
          return null;
        }
        return {
          type: 'damage',
          attackerUid: p[1],
          victimUid: p[2],
          damage: p[3],
          hitZone: p[4] === 0 ? 'head' : 'body',
          hpAfter: p[5],
          armorAfter: p[6],
          killed: p[7] === 1,
          weaponId: idxToWeapon(p[8]),
        };
      }
      case 'rs': {
        if (
          p.length < 6 ||
          typeof p[1] !== 'string' ||
          !isFiniteNum(p[2]) ||
          !isFiniteNum(p[3]) ||
          !isFiniteNum(p[4]) ||
          !isFiniteNum(p[5])
        ) {
          return null;
        }
        return {
          type: 'respawn',
          uid: p[1],
          pos: { x: p[2], y: p[3], z: p[4] },
          yaw: p[5],
        };
      }
      case 'rl': {
        if (p.length < 3 || typeof p[1] !== 'string') {
          return null;
        }
        return {
          type: 'reload',
          uid: p[1],
          weaponId: idxToWeapon(p[2]),
        };
      }
      case 'fs': {
        if (
          p.length < 5 ||
          typeof p[1] !== 'string' ||
          !isFiniteNum(p[2]) ||
          !isFiniteNum(p[3]) ||
          !isFiniteNum(p[4])
        ) {
          return null;
        }
        return {
          type: 'footstep',
          uid: p[1],
          pos: { x: p[2], y: p[3], z: p[4] },
        };
      }
      case 'br': {
        if (
          p.length < 8 ||
          typeof p[1] !== 'string' ||
          !isFiniteNum(p[4]) ||
          !isFiniteNum(p[5]) ||
          !isFiniteNum(p[6]) ||
          !isFiniteNum(p[7])
        ) {
          return null;
        }
        const reason = typeof p[3] === 'string' && p[3].length > 0 ? p[3] : undefined;
        const weaponId = idxToNullableWeapon(p[5]) ?? undefined;
        const armor = p[6] >= 0 ? p[6] : undefined;
        const armorMax = p[7] >= 0 ? p[7] : undefined;
        return {
          type: 'buy_result',
          uid: p[1],
          ok: p[2] === 1,
          ...(reason ? { reason } : {}),
          credits: p[4],
          ...(weaponId ? { weaponId } : {}),
          ...(armor !== undefined ? { armor } : {}),
          ...(armorMax !== undefined ? { armorMax } : {}),
        };
      }
      case 'rp': {
        if (
          p.length < 10 ||
          !isFiniteNum(p[2]) ||
          !isFiniteNum(p[3]) ||
          !isFiniteNum(p[4])
        ) {
          return null;
        }
        const winnerTeam = codeToTeam(p[5]);
        const winReason = idxToWinReason(p[6]);
        const sidesSwapped = p[7] === 1 ? true : p[7] === 0 ? false : undefined;
        const isSuddenDeath = p[8] === 1 ? true : p[8] === 0 ? false : undefined;
        const matchWinnerTeam = codeToTeam(p[9]);
        return {
          type: 'round_phase',
          phase: idxToPhase(p[1]),
          roundNumber: Math.trunc(p[2]),
          scoreA: Math.trunc(p[3]),
          scoreB: Math.trunc(p[4]),
          ...(winnerTeam ? { winnerTeam } : {}),
          ...(winReason ? { winReason } : {}),
          ...(sidesSwapped !== undefined ? { sidesSwapped } : {}),
          ...(isSuddenDeath !== undefined ? { isSuddenDeath } : {}),
          ...(matchWinnerTeam ? { matchWinnerTeam } : {}),
        };
      }
      case 'ke': {
        if (
          p.length < 7 ||
          !isFiniteNum(p[1]) ||
          !isFiniteNum(p[4]) ||
          !isFiniteNum(p[5]) ||
          !isFiniteNum(p[6])
        ) {
          return null;
        }
        const actIdx = Math.trunc(p[1]);
        const action: KernEventAction =
          actIdx >= 0 && actIdx < KERN_ACTION_TABLE.length
            ? KERN_ACTION_TABLE[actIdx]
            : 'dropped';
        const uid = typeof p[2] === 'string' && p[2].length > 0 ? p[2] : undefined;
        const zone = p[3] === 'A' || p[3] === 'B' ? p[3] : undefined;
        return {
          type: 'kern_event',
          action,
          ...(uid ? { uid } : {}),
          ...(zone ? { zone } : {}),
          pos: { x: p[4], y: p[5], z: p[6] },
        };
      }
      case 'ac': {
        if (
          p.length < 9 ||
          typeof p[1] !== 'string' ||
          (p[2] !== 'A' && p[2] !== 'D') ||
          !isAbilitySlot(p[4]) ||
          typeof p[5] !== 'string' ||
          !isFiniteNum(p[6]) ||
          !isFiniteNum(p[7]) ||
          !isFiniteNum(p[8])
        ) {
          return null;
        }
        const hasTarget =
          p.length >= 12 &&
          isFiniteNum(p[9]) &&
          isFiniteNum(p[10]) &&
          isFiniteNum(p[11]);
        return {
          type: 'ability_cast',
          uid: p[1],
          team: p[2],
          character: idxToChar(p[3]),
          slot: p[4],
          abilityName: p[5],
          origin: { x: p[6], y: p[7], z: p[8] },
          ...(hasTarget
            ? { targetPos: { x: p[9] as number, y: p[10] as number, z: p[11] as number } }
            : {}),
        };
      }
      case 'ee': {
        if (
          p.length < 7 ||
          typeof p[1] !== 'string' ||
          !isFiniteNum(p[4]) ||
          !isFiniteNum(p[5]) ||
          !isFiniteNum(p[6])
        ) {
          return null;
        }
        return {
          type: 'effect_event',
          effectId: p[1],
          kind: idxToEffectKind(p[2]),
          action: p[3] === 0 ? 'triggered' : 'destroyed',
          pos: { x: p[4], y: p[5], z: p[6] },
        };
      }
      case 'ct': {
        if (
          p.length < 7 ||
          typeof p[1] !== 'string' ||
          typeof p[2] !== 'string' ||
          (p[3] !== 'A' && p[3] !== 'D') ||
          typeof p[4] !== 'string' ||
          !isFiniteNum(p[6])
        ) {
          return null;
        }
        const text = sanitizeChatText(p[4], MAX_CHAT_TEXT_LENGTH);
        if (text.length === 0) {
          return null;
        }
        return {
          type: 'chat',
          uid: p[1],
          senderName: sanitizeChatText(p[2], MAX_CHAT_SENDER_LENGTH) || 'Spezialist',
          team: p[3],
          text,
          teamOnly: p[5] === 1,
          timestampMs: Math.round(p[6]),
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function encodeClientMessage(msg: ClientReliableMessage): string {
  switch (msg.type) {
    case 'buy_request':
      return JSON.stringify(['c', 'buy', msg.itemType, msg.itemId]);
    case 'ability_use':
      if (msg.targetPos) {
        return JSON.stringify([
          'c',
          'ab',
          msg.slot,
          round3(msg.yaw),
          round3(msg.pitch),
          round2(msg.targetPos.x),
          round2(msg.targetPos.y),
          round2(msg.targetPos.z),
        ]);
      }
      return JSON.stringify(['c', 'ab', msg.slot, round3(msg.yaw), round3(msg.pitch)]);
    case 'chat': {
      const cleaned = sanitizeChatText(msg.text, MAX_CHAT_TEXT_LENGTH);
      if (msg.teamOnly === undefined) {
        return JSON.stringify(['c', 'ch', cleaned]);
      }
      return JSON.stringify(['c', 'ch', cleaned, msg.teamOnly ? 1 : 0]);
    }
    case 'restart_match':
      return JSON.stringify(['c', 'rm']);
  }
}

export function decodeClientMessage(raw: string): ClientReliableMessage | null {
  try {
    const p: unknown = JSON.parse(raw);
    if (!Array.isArray(p) || p.length < 2 || p[0] !== 'c' || typeof p[1] !== 'string') {
      return null;
    }
    switch (p[1]) {
      case 'buy': {
        if (p.length < 4 || typeof p[2] !== 'string' || typeof p[3] !== 'string') {
          return null;
        }
        if (!(BUY_ITEM_TYPES as readonly string[]).includes(p[2])) {
          return null;
        }
        return {
          type: 'buy_request',
          itemType: p[2] as BuyItemType,
          itemId: p[3],
        };
      }
      case 'ab': {
        if (
          p.length < 5 ||
          !isAbilitySlot(p[2]) ||
          !isFiniteNum(p[3]) ||
          !isFiniteNum(p[4])
        ) {
          return null;
        }
        const hasTarget =
          p.length >= 8 &&
          isFiniteNum(p[5]) &&
          isFiniteNum(p[6]) &&
          isFiniteNum(p[7]);
        return {
          type: 'ability_use',
          slot: p[2],
          yaw: p[3],
          pitch: p[4],
          ...(hasTarget
            ? { targetPos: { x: p[5] as number, y: p[6] as number, z: p[7] as number } }
            : {}),
        };
      }
      case 'ch': {
        if (p.length < 3 || typeof p[2] !== 'string') {
          return null;
        }
        const text = sanitizeChatText(p[2], MAX_CHAT_TEXT_LENGTH);
        const hasTeamFlag = p.length >= 4 && (p[3] === 0 || p[3] === 1);
        return {
          type: 'chat',
          text,
          ...(hasTeamFlag ? { teamOnly: p[3] === 1 } : {}),
        };
      }
      case 'rm':
        return { type: 'restart_match' };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
