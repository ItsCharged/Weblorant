import type { WeaponId } from '../core/types';

export type WeaponCategory =
  | 'Pistole'
  | 'Schwere Pistole'
  | 'MP'
  | 'Schrotflinte'
  | 'Sturmgewehr'
  | 'Präzisionsgewehr';

export interface RecoilPoint {
  pitchDeg: number;
  yawDeg: number;
}

/**
 * Visier-Typen:
 * - `none`   : kein Zielen (Rechtsklick ohne Wirkung)
 * - `reflex` : offenes Leuchtpunkt-Visier, geringer Zoom
 * - `holo`   : Holo-Ring-Visier, mittlerer Zoom
 * - `sniper` : Präzisionsoptik, Vollbild-Okular, 2 Zoomstufen
 */
export type ScopeType = 'none' | 'reflex' | 'holo' | 'sniper';

export interface ScopeSpec {
  type: ScopeType;
  /** Vergrößerungsfaktoren pro Zoomstufe (Rechtsklick wechselt bei Präzision durch). */
  zoomLevels: number[];
  /** Multiplikator auf die Streuung beim Zielen (Präzision: separate Sonderregel). */
  adsSpreadMult: number;
}

export interface WeaponStats {
  id: WeaponId;
  name: string;
  category: WeaponCategory;
  price: number;
  headDamage: number;
  bodyDamage: number;
  pellets: number;
  fireRate: number;
  automatic: boolean;
  magSize: number;
  reserveAmmo: number;
  reloadTimeSec: number;
  /** true, sobald die Waffe irgendein Zielvisier (Rechtsklick) besitzt. */
  hasScopeZoom: boolean;
  scope: ScopeSpec;
  falloffStartM: number;
  falloffEndM: number;
  falloffMinMultiplier: number;
  spreadStandFirstShotDeg: number;
  spreadStandBaseDeg: number;
  spreadCrouchMultiplier: number;
  spreadWalkDeg: number;
  spreadRunDeg: number;
  spreadAirDeg: number;
  spreadPerShotDeg: number;
  recoilRecoveryRate: number;
  recoilPattern: RecoilPoint[];
}

export type ArmorTierId = 'none' | 'light' | 'heavy';

export interface ArmorTier {
  id: ArmorTierId;
  name: string;
  price: number;
  armor: number;
}

export const ARMOR_TIERS: Record<ArmorTierId, ArmorTier> = {
  none: {
    id: 'none',
    name: 'Kein Schild',
    price: 0,
    armor: 0,
  },
  light: {
    id: 'light',
    name: 'Leichter Schild',
    price: 400,
    armor: 25,
  },
  heavy: {
    id: 'heavy',
    name: 'Schwerer Schild',
    price: 1000,
    armor: 50,
  },
};

export const DEFAULT_WEAPON_ID: WeaponId = 'lanze';

export const WEAPON_IDS: readonly WeaponId[] = [
  'funke',
  'bolzer',
  'hornisse',
  'brecher',
  'lanze',
  'falke',
];

const FUNKE_RECOIL: RecoilPoint[] = [
  { pitchDeg: 0, yawDeg: 0 },
  { pitchDeg: 0.45, yawDeg: 0.04 },
  { pitchDeg: 0.92, yawDeg: -0.05 },
  { pitchDeg: 1.38, yawDeg: 0.08 },
  { pitchDeg: 1.82, yawDeg: -0.1 },
  { pitchDeg: 2.2, yawDeg: 0.14 },
  { pitchDeg: 2.52, yawDeg: 0.28 },
  { pitchDeg: 2.78, yawDeg: 0.12 },
  { pitchDeg: 2.95, yawDeg: -0.18 },
  { pitchDeg: 3.08, yawDeg: -0.32 },
  { pitchDeg: 3.16, yawDeg: -0.12 },
  { pitchDeg: 3.22, yawDeg: 0.16 },
];

const BOLZER_RECOIL: RecoilPoint[] = [
  { pitchDeg: 0, yawDeg: 0 },
  { pitchDeg: 2.1, yawDeg: 0.15 },
  { pitchDeg: 3.9, yawDeg: -0.22 },
  { pitchDeg: 5.2, yawDeg: 0.35 },
  { pitchDeg: 6.1, yawDeg: -0.4 },
  { pitchDeg: 6.6, yawDeg: 0.28 },
];

const HORNISSE_RECOIL: RecoilPoint[] = [
  { pitchDeg: 0, yawDeg: 0 },
  { pitchDeg: 0.55, yawDeg: 0.04 },
  { pitchDeg: 1.15, yawDeg: -0.05 },
  { pitchDeg: 1.78, yawDeg: 0.08 },
  { pitchDeg: 2.42, yawDeg: 0.12 },
  { pitchDeg: 3.05, yawDeg: 0.05 },
  { pitchDeg: 3.65, yawDeg: -0.08 },
  { pitchDeg: 4.2, yawDeg: 0.1 },
  { pitchDeg: 4.7, yawDeg: 0.65 },
  { pitchDeg: 5.1, yawDeg: 1.25 },
  { pitchDeg: 5.4, yawDeg: 1.85 },
  { pitchDeg: 5.6, yawDeg: 2.3 },
  { pitchDeg: 5.75, yawDeg: 2.5 },
  { pitchDeg: 5.8, yawDeg: 2.15 },
  { pitchDeg: 5.85, yawDeg: 1.45 },
  { pitchDeg: 5.85, yawDeg: 0.55 },
  { pitchDeg: 5.8, yawDeg: -0.45 },
  { pitchDeg: 5.8, yawDeg: -1.35 },
  { pitchDeg: 5.85, yawDeg: -2.05 },
  { pitchDeg: 5.9, yawDeg: -2.55 },
  { pitchDeg: 5.85, yawDeg: -2.65 },
  { pitchDeg: 5.8, yawDeg: -2.25 },
  { pitchDeg: 5.8, yawDeg: -1.5 },
  { pitchDeg: 5.85, yawDeg: -0.6 },
  { pitchDeg: 5.9, yawDeg: 0.35 },
  { pitchDeg: 5.9, yawDeg: 1.2 },
  { pitchDeg: 5.85, yawDeg: 1.85 },
  { pitchDeg: 5.85, yawDeg: 2.15 },
  { pitchDeg: 5.8, yawDeg: 2.0 },
  { pitchDeg: 5.8, yawDeg: 1.65 },
];

const BRECHER_RECOIL: RecoilPoint[] = [
  { pitchDeg: 0, yawDeg: 0 },
  { pitchDeg: 2.4, yawDeg: 0.2 },
  { pitchDeg: 4.2, yawDeg: -0.25 },
  { pitchDeg: 5.4, yawDeg: 0.3 },
  { pitchDeg: 6.1, yawDeg: -0.2 },
  { pitchDeg: 6.5, yawDeg: 0.15 },
];

// 25-point deterministic pattern:
// Shots 1..8 (indices 0..7): steady vertical climb from 0 up to 7.5 deg pitch with minimal yaw drift.
// Shots 9..25 (indices 8..24): pitch plateau ~8.2 deg with horizontal oscillation (+3.2 -> -3.4 -> +2.8 deg).
const LANZE_RECOIL: RecoilPoint[] = [
  { pitchDeg: 0, yawDeg: 0 },
  { pitchDeg: 1.05, yawDeg: 0.04 },
  { pitchDeg: 2.15, yawDeg: -0.05 },
  { pitchDeg: 3.3, yawDeg: 0.08 },
  { pitchDeg: 4.45, yawDeg: 0.11 },
  { pitchDeg: 5.55, yawDeg: 0.05 },
  { pitchDeg: 6.55, yawDeg: -0.07 },
  { pitchDeg: 7.5, yawDeg: 0.1 },
  { pitchDeg: 7.95, yawDeg: 1.15 },
  { pitchDeg: 8.15, yawDeg: 2.25 },
  { pitchDeg: 8.25, yawDeg: 3.0 },
  { pitchDeg: 8.2, yawDeg: 3.2 },
  { pitchDeg: 8.15, yawDeg: 2.35 },
  { pitchDeg: 8.2, yawDeg: 0.85 },
  { pitchDeg: 8.25, yawDeg: -0.95 },
  { pitchDeg: 8.3, yawDeg: -2.35 },
  { pitchDeg: 8.25, yawDeg: -3.15 },
  { pitchDeg: 8.2, yawDeg: -3.4 },
  { pitchDeg: 8.15, yawDeg: -2.55 },
  { pitchDeg: 8.2, yawDeg: -1.1 },
  { pitchDeg: 8.25, yawDeg: 0.55 },
  { pitchDeg: 8.3, yawDeg: 1.85 },
  { pitchDeg: 8.25, yawDeg: 2.6 },
  { pitchDeg: 8.2, yawDeg: 2.8 },
  { pitchDeg: 8.2, yawDeg: 2.45 },
];

const FALKE_RECOIL: RecoilPoint[] = [
  { pitchDeg: 0, yawDeg: 0 },
  { pitchDeg: 4.5, yawDeg: 0.15 },
  { pitchDeg: 6.8, yawDeg: -0.2 },
  { pitchDeg: 8.0, yawDeg: 0.25 },
  { pitchDeg: 8.5, yawDeg: -0.15 },
];

export const WEAPONS: Record<WeaponId, WeaponStats> = {
  funke: {
    id: 'funke',
    name: 'Funke',
    category: 'Pistole',
    price: 0,
    headDamage: 75,
    bodyDamage: 26,
    pellets: 1,
    fireRate: 6,
    automatic: false,
    magSize: 12,
    reserveAmmo: 36,
    reloadTimeSec: 1.6,
    hasScopeZoom: false,
    scope: { type: 'none', zoomLevels: [1], adsSpreadMult: 1 },
    falloffStartM: 20,
    falloffEndM: 45,
    falloffMinMultiplier: 0.82,
    spreadStandFirstShotDeg: 0,
    spreadStandBaseDeg: 0.22,
    spreadCrouchMultiplier: 0.65,
    spreadWalkDeg: 1.1,
    spreadRunDeg: 2.8,
    spreadAirDeg: 5.0,
    spreadPerShotDeg: 0.14,
    recoilRecoveryRate: 16,
    recoilPattern: FUNKE_RECOIL,
  },
  bolzer: {
    id: 'bolzer',
    name: 'Bolzer',
    category: 'Schwere Pistole',
    price: 500,
    headDamage: 150,
    bodyDamage: 50,
    pellets: 1,
    fireRate: 2,
    automatic: false,
    magSize: 6,
    reserveAmmo: 24,
    reloadTimeSec: 2.0,
    hasScopeZoom: true,
    scope: { type: 'reflex', zoomLevels: [1.15], adsSpreadMult: 0.8 },
    falloffStartM: 30,
    falloffEndM: 55,
    falloffMinMultiplier: 0.85,
    spreadStandFirstShotDeg: 0,
    spreadStandBaseDeg: 0.2,
    spreadCrouchMultiplier: 0.65,
    spreadWalkDeg: 1.6,
    spreadRunDeg: 3.8,
    spreadAirDeg: 6.5,
    spreadPerShotDeg: 0.35,
    recoilRecoveryRate: 10,
    recoilPattern: BOLZER_RECOIL,
  },
  hornisse: {
    id: 'hornisse',
    name: 'Hornisse',
    category: 'MP',
    price: 1500,
    headDamage: 70,
    bodyDamage: 25,
    pellets: 1,
    fireRate: 13,
    automatic: true,
    magSize: 30,
    reserveAmmo: 90,
    reloadTimeSec: 2.0,
    hasScopeZoom: true,
    scope: { type: 'reflex', zoomLevels: [1.15], adsSpreadMult: 0.75 },
    falloffStartM: 15,
    falloffEndM: 35,
    falloffMinMultiplier: 0.72,
    spreadStandFirstShotDeg: 0,
    spreadStandBaseDeg: 0.35,
    spreadCrouchMultiplier: 0.7,
    spreadWalkDeg: 1.2,
    spreadRunDeg: 2.9,
    spreadAirDeg: 5.5,
    spreadPerShotDeg: 0.07,
    recoilRecoveryRate: 16,
    recoilPattern: HORNISSE_RECOIL,
  },
  brecher: {
    id: 'brecher',
    name: 'Brecher',
    category: 'Schrotflinte',
    price: 1800,
    headDamage: 30,
    bodyDamage: 12,
    pellets: 8,
    fireRate: 1.2,
    automatic: false,
    magSize: 6,
    reserveAmmo: 18,
    reloadTimeSec: 2.4,
    hasScopeZoom: false,
    scope: { type: 'none', zoomLevels: [1], adsSpreadMult: 1 },
    falloffStartM: 8,
    falloffEndM: 22,
    falloffMinMultiplier: 0.45,
    spreadStandFirstShotDeg: 2.6,
    spreadStandBaseDeg: 2.8,
    spreadCrouchMultiplier: 0.8,
    spreadWalkDeg: 3.4,
    spreadRunDeg: 4.8,
    spreadAirDeg: 6.8,
    spreadPerShotDeg: 0.3,
    recoilRecoveryRate: 8,
    recoilPattern: BRECHER_RECOIL,
  },
  lanze: {
    id: 'lanze',
    name: 'Lanze',
    category: 'Sturmgewehr',
    price: 2900,
    headDamage: 150,
    bodyDamage: 40,
    pellets: 1,
    fireRate: 9.5,
    automatic: true,
    magSize: 25,
    reserveAmmo: 75,
    reloadTimeSec: 2.2,
    hasScopeZoom: true,
    scope: { type: 'holo', zoomLevels: [1.25], adsSpreadMult: 0.7 },
    falloffStartM: 50,
    falloffEndM: 100,
    falloffMinMultiplier: 1.0,
    spreadStandFirstShotDeg: 0,
    spreadStandBaseDeg: 0.24,
    spreadCrouchMultiplier: 0.65,
    spreadWalkDeg: 1.8,
    spreadRunDeg: 4.5,
    spreadAirDeg: 7.5,
    spreadPerShotDeg: 0.08,
    recoilRecoveryRate: 14,
    recoilPattern: LANZE_RECOIL,
  },
  falke: {
    id: 'falke',
    name: 'Falke',
    category: 'Präzisionsgewehr',
    price: 4500,
    headDamage: 255,
    bodyDamage: 150,
    pellets: 1,
    fireRate: 0.7,
    automatic: false,
    magSize: 5,
    reserveAmmo: 15,
    reloadTimeSec: 2.8,
    hasScopeZoom: true,
    scope: { type: 'sniper', zoomLevels: [2.5, 5], adsSpreadMult: 0.25 },
    falloffStartM: 80,
    falloffEndM: 150,
    falloffMinMultiplier: 1.0,
    spreadStandFirstShotDeg: 0,
    spreadStandBaseDeg: 0.15,
    spreadCrouchMultiplier: 0.6,
    spreadWalkDeg: 3.2,
    spreadRunDeg: 6.5,
    spreadAirDeg: 9.5,
    spreadPerShotDeg: 0.5,
    recoilRecoveryRate: 6,
    recoilPattern: FALKE_RECOIL,
  },
};
