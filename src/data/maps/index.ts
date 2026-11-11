import type { MapId } from '../../core/types';
import { HAFENWERK_MAP } from './hafenwerk';
import { KRYOWERK_MAP } from './kryowerk';
import type { MapDefinition } from './types';
import { UEBUNGSANLAGE_MAP } from './uebungsanlage';
import { WERKSTADT_MAP } from './werkstadt';

export * from './types';
export { HAFENWERK_MAP } from './hafenwerk';
export { KRYOWERK_MAP } from './kryowerk';
export { UEBUNGSANLAGE_MAP } from './uebungsanlage';
export { WERKSTADT_MAP } from './werkstadt';

export const MAPS: Record<MapId, MapDefinition> = {
  hafenwerk: HAFENWERK_MAP,
  werkstadt: WERKSTADT_MAP,
  kryowerk: KRYOWERK_MAP,
  uebungsanlage: UEBUNGSANLAGE_MAP,
};

export const TACTICAL_MAPS: readonly MapDefinition[] = [
  HAFENWERK_MAP,
  WERKSTADT_MAP,
  KRYOWERK_MAP,
];

export const MAP_LIST: readonly MapDefinition[] = [
  HAFENWERK_MAP,
  WERKSTADT_MAP,
  KRYOWERK_MAP,
  UEBUNGSANLAGE_MAP,
];

export function getMapDefinition(id: MapId): MapDefinition {
  return MAPS[id];
}
