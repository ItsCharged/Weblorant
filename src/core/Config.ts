import type { GameSettings } from './types';

export const SIM_TICK_RATE = 30;
export const SIM_DT = 1 / 30;

export const PLAYER_RADIUS = 0.38;
export const STAND_HEIGHT = 1.78;
export const CROUCH_HEIGHT = 1.22;
export const STAND_EYE_HEIGHT = 1.62;
export const CROUCH_EYE_HEIGHT = 1.08;

export const RUN_SPEED = 5.6;
export const WALK_SPEED = 3.0;
export const CROUCH_SPEED = 2.4;
export const JUMP_SPEED = 7.2;
export const GRAVITY = -22.0;

export const PITCH_LIMIT = 1.52;
export const MOUSE_RAD_PER_COUNT = 0.0022;

export const BUY_PHASE_SEC = 25;
export const ACTION_PHASE_SEC = 100;
export const KERN_PLANT_SEC = 4.0;
export const KERN_FUSE_SEC = 40.0;
export const KERN_DEFUSE_SEC = 7.0;
export const KERN_DEFUSE_CHECKPOINT = 0.5;
export const POST_ROUND_SEC = 4.5;

export const START_CREDITS = 800;
export const MAX_CREDITS = 9000;
export const WIN_CREDITS = 2800;
export const LOSS_STREAK_CREDITS = [1800, 2300, 2800] as const;
export const KILL_CREDITS = 200;
export const PLANT_BONUS_CREDITS = 300;
export const SUDDEN_DEATH_CREDITS = 5000;

export const KNIFE_RUN_SPEED = 6.15;

export const LAG_COMP_HISTORY_MS = 1000;
export const LAG_COMP_MAX_REWIND_MS = 200;

export const SPAWN_BARRIER_Z = 35.5;


export const DEFAULT_SETTINGS: GameSettings = {
  graphics: 'high',
  sensitivity: 1.0,
  fov: 90,
  volume: 0.7,
  crosshair: {
    color: '#18d4c9',
    size: 8,
    thickness: 2,
    gap: 4,
    dynamicSpread: true,
  },
};
