import {
  ACTION_PHASE_SEC,
  BUY_PHASE_SEC,
  KERN_FUSE_SEC,
  POST_ROUND_SEC,
} from '../core/Config';
import { vec3Dist } from '../core/math';
import type {
  MatchPhase,
  NetGameEvent,
  RoundStateSnapshot,
  RoundWinReason,
  TeamId,
  Vec3,
} from '../core/types';
import { CHARACTERS } from '../data/characters';
import type { MapZone } from '../data/maps/types';
import {
  applyNextRoundCarryoverLoadouts,
  type PlayerEconomyLoadout,
  resetEconomyForHalftime,
  resetEconomyForSuddenDeath,
  settleRoundCredits,
  type TeamLossStreaks,
} from './Economy';
import { KERN_BLAST_RADIUS_M, type KernActorState, KernController } from './KernLogic';

export const DEFAULT_ROUNDS_TO_WIN = 7;

export interface RoundParticipantState extends PlayerEconomyLoadout {
  grounded: boolean;
  horizontalSpeed: number;
  holdKern: boolean;
  hp: number;
  kills: number;
  deaths: number;
  assists: number;
  plants: number;
  defuses: number;
  ultPoints: number;
}

export interface RoundManagerOptions {
  roundsToWin?: number;
  zones?: ReadonlyArray<MapZone>;
}

export interface RoundStepOutcome {
  events: NetGameEvent[];
  barriersChangedTo?: boolean;
  roundStartedRespawnNeeded: boolean;
  sidesJustSwapped: boolean;
  blastKilledUids: string[];
  plantedByUid?: string;
  defusedByUid?: string;
}

export function getMaxUltPoints(character: RoundParticipantState['character']): number {
  return CHARACTERS[character].abilities.ult.ultPoints ?? 7;
}

export function addUltPoint(player: { character: RoundParticipantState['character']; ultPoints: number }, delta = 1): number {
  const maxUlt = getMaxUltPoints(player.character);
  player.ultPoints = Math.min(maxUlt, Math.max(0, player.ultPoints + delta));
  return player.ultPoints;
}

/**
 * Pure deterministic Kernbruch Tactical Round State Machine (`First-to-7`,
 * `25s` Buy -> `100s` Action -> `40s` Planted -> `4.5s` Post-Round -> Halftime Swap after 6 rounds -> `6:6` Sudden Death).
 * Pure TypeScript — zero 3D engine or DOM imports.
 */
export class RoundManager {
  public readonly roundsToWin: number;
  public readonly kern = new KernController();
  public readonly lossStreaks: TeamLossStreaks = { A: 0, D: 0 };

  public roundNumber = 1;
  public scoreA = 0;
  public scoreB = 0;
  public phase: MatchPhase = 'buy';
  public phaseRemainingSec: number = BUY_PHASE_SEC;
  public barriersActive = true;
  public sidesSwapped = false;
  public isSuddenDeath = false;
  public winnerTeam: TeamId | undefined = undefined;
  public winReason: RoundWinReason | undefined = undefined;
  public matchWinnerTeam: TeamId | undefined = undefined;

  private zones: ReadonlyArray<MapZone>;
  private bothTeamsPresentAtRoundStart = false;

  constructor(options: RoundManagerOptions = {}) {
    this.roundsToWin = Math.max(1, options.roundsToWin ?? DEFAULT_ROUNDS_TO_WIN);
    this.zones = options.zones ?? [];
  }

  public setZones(zones: ReadonlyArray<MapZone>): void {
    this.zones = zones;
  }

  /**
   * Initializes Round 1 `'buy'` phase for the current participant list.
   */
  public startMatch(players: ReadonlyArray<RoundParticipantState>): NetGameEvent {
    this.roundNumber = 1;
    this.scoreA = 0;
    this.scoreB = 0;
    this.phase = 'buy';
    this.phaseRemainingSec = BUY_PHASE_SEC;
    this.barriersActive = true;
    this.sidesSwapped = false;
    this.isSuddenDeath = false;
    this.winnerTeam = undefined;
    this.winReason = undefined;
    this.matchWinnerTeam = undefined;
    this.lossStreaks.A = 0;
    this.lossStreaks.D = 0;

    resetEconomyForHalftime(players, this.lossStreaks);
    for (const p of players) {
      p.alive = true;
      p.hp = 100;
      p.kills = 0;
      p.deaths = 0;
      p.assists = 0;
      p.plants = 0;
      p.defuses = 0;
      p.ultPoints = 0;
    }

    this.bothTeamsPresentAtRoundStart = this.hasBothTeams(players);
    this.kern.resetForRound(players);

    return {
      type: 'round_phase',
      phase: 'buy',
      roundNumber: this.roundNumber,
      scoreA: this.scoreA,
      scoreB: this.scoreB,
      sidesSwapped: this.sidesSwapped,
      isSuddenDeath: this.isSuddenDeath,
    };
  }

  /**
   * Notifies the round engine when a player dies or disconnects so carried Kern drops immediately.
   */
  public notifyPlayerDownOrLeft(uid: string, lastPos?: Vec3): NetGameEvent | null {
    if (this.kern.carrierUid === uid) {
      return this.kern.dropFromCarrier(lastPos);
    }
    if (this.kern.actorUid === uid && this.kern.status === 'defusing') {
      this.kern.status = 'planted';
      this.kern.actorUid = undefined;
      this.kern.defuseTimerSec = this.kern.halfDefused ? 3.5 : 0;
    }
    return null;
  }

  /**
   * Advances the round state machine by `dt` seconds.
   */
  public step(dt: number, players: ReadonlyArray<RoundParticipantState>): RoundStepOutcome {
    const events: NetGameEvent[] = [];
    const blastKilledUids: string[] = [];
    let barriersChangedTo: boolean | undefined;
    let roundStartedRespawnNeeded = false;
    let sidesJustSwapped = false;
    let plantedByUid: string | undefined;
    let defusedByUid: string | undefined;

    if (dt <= 0 || this.phase === 'ended') {
      return {
        events,
        roundStartedRespawnNeeded: false,
        sidesJustSwapped: false,
        blastKilledUids,
      };
    }

    const actors: KernActorState[] = players.map((p) => ({
      uid: p.uid,
      team: p.team,
      alive: p.alive,
      pos: p.pos,
      grounded: p.grounded,
      horizontalSpeed: p.horizontalSpeed,
      holdKern: p.holdKern,
    }));

    if (this.phase === 'buy') {
      events.push(...this.kern.syncBuyPhase(actors));
      this.phaseRemainingSec = Math.max(0, this.phaseRemainingSec - dt);

      if (this.phaseRemainingSec <= 1e-6) {
        this.phase = 'action';
        this.phaseRemainingSec = ACTION_PHASE_SEC;
        this.barriersActive = false;
        barriersChangedTo = false;
        this.bothTeamsPresentAtRoundStart = this.hasBothTeams(players);

        events.push({
          type: 'round_phase',
          phase: 'action',
          roundNumber: this.roundNumber,
          scoreA: this.scoreA,
          scoreB: this.scoreB,
          sidesSwapped: this.sidesSwapped,
          isSuddenDeath: this.isSuddenDeath,
        });
      }

      return {
        events,
        barriersChangedTo,
        roundStartedRespawnNeeded,
        sidesJustSwapped,
        blastKilledUids,
      };
    }

    if (this.phase === 'action') {
      this.phaseRemainingSec = Math.max(0, this.phaseRemainingSec - dt);

      const kernRes = this.kern.stepActionPhase(dt, actors, this.zones);
      events.push(...kernRes.events);

      if (kernRes.justPlantedByUid) {
        plantedByUid = kernRes.justPlantedByUid;
        const planter = players.find((p) => p.uid === kernRes.justPlantedByUid);
        if (planter) {
          planter.plants += 1;
          addUltPoint(planter, 1);
        }

        this.phase = 'planted';
        this.phaseRemainingSec = KERN_FUSE_SEC;
        events.push({
          type: 'round_phase',
          phase: 'planted',
          roundNumber: this.roundNumber,
          scoreA: this.scoreA,
          scoreB: this.scoreB,
          sidesSwapped: this.sidesSwapped,
          isSuddenDeath: this.isSuddenDeath,
        });

        return {
          events,
          barriersChangedTo,
          roundStartedRespawnNeeded,
          sidesJustSwapped,
          blastKilledUids,
          plantedByUid,
        };
      }

      // Team-wipe elimination (only evaluated when BOTH teams had >= 1 player at round start!)
      if (this.bothTeamsPresentAtRoundStart) {
        const aliveAttackers = this.countAliveOnTeam(players, 'A');
        const aliveDefenders = this.countAliveOnTeam(players, 'D');

        if (aliveDefenders === 0) {
          events.push(this.enterPostRound(players, 'A', 'defenders_eliminated'));
          return {
            events,
            barriersChangedTo,
            roundStartedRespawnNeeded,
            sidesJustSwapped,
            blastKilledUids,
          };
        }

        if (aliveAttackers === 0) {
          events.push(this.enterPostRound(players, 'D', 'attackers_eliminated'));
          return {
            events,
            barriersChangedTo,
            roundStartedRespawnNeeded,
            sidesJustSwapped,
            blastKilledUids,
          };
        }
      }

      if (this.phaseRemainingSec <= 1e-6) {
        events.push(this.enterPostRound(players, 'D', 'time_expired'));
      }

      return {
        events,
        barriersChangedTo,
        roundStartedRespawnNeeded,
        sidesJustSwapped,
        blastKilledUids,
      };
    }

    if (this.phase === 'planted') {
      const plantedRes = this.kern.stepPlantedPhase(dt, actors);
      events.push(...plantedRes.events);
      this.phaseRemainingSec = this.kern.fuseRemainingSec;

      if (plantedRes.defusedByUid) {
        defusedByUid = plantedRes.defusedByUid;
        const defuser = players.find((p) => p.uid === plantedRes.defusedByUid);
        if (defuser) {
          defuser.defuses += 1;
          addUltPoint(defuser, 1);
        }
        events.push(this.enterPostRound(players, 'D', 'kern_defused'));
        return {
          events,
          barriersChangedTo,
          roundStartedRespawnNeeded,
          sidesJustSwapped,
          blastKilledUids,
          defusedByUid,
        };
      }

      if (plantedRes.detonated) {
        for (const p of players) {
          if (p.alive && vec3Dist(p.pos, this.kern.pos) <= KERN_BLAST_RADIUS_M) {
            p.alive = false;
            p.hp = 0;
            p.armor = 0;
            p.deaths += 1;
            addUltPoint(p, 1);
            blastKilledUids.push(p.uid);
          }
        }
        events.push(this.enterPostRound(players, 'A', 'kern_detonated'));
        return {
          events,
          barriersChangedTo,
          roundStartedRespawnNeeded,
          sidesJustSwapped,
          blastKilledUids,
        };
      }

      // Note: post-plant, killing all Defenders wins immediately for Attackers,
      // whereas killing all Attackers does NOT end the round — Defenders must still defuse!
      if (this.bothTeamsPresentAtRoundStart) {
        const aliveDefenders = this.countAliveOnTeam(players, 'D');
        if (aliveDefenders === 0) {
          events.push(this.enterPostRound(players, 'A', 'defenders_eliminated'));
        }
      }

      return {
        events,
        barriersChangedTo,
        roundStartedRespawnNeeded,
        sidesJustSwapped,
        blastKilledUids,
      };
    }

    if (this.phase === 'post_round') {
      this.phaseRemainingSec = Math.max(0, this.phaseRemainingSec - dt);
      if (this.phaseRemainingSec <= 1e-6) {
        if (this.scoreA >= this.roundsToWin || this.scoreB >= this.roundsToWin) {
          this.phase = 'ended';
          this.phaseRemainingSec = 0;
          this.matchWinnerTeam = this.scoreA >= this.roundsToWin ? 'A' : 'D';
          events.push({
            type: 'round_phase',
            phase: 'ended',
            roundNumber: this.roundNumber,
            scoreA: this.scoreA,
            scoreB: this.scoreB,
            winnerTeam: this.winnerTeam,
            winReason: this.winReason,
            sidesSwapped: this.sidesSwapped,
            isSuddenDeath: this.isSuddenDeath,
            matchWinnerTeam: this.matchWinnerTeam,
          });
        } else {
          const transition = this.advanceToNextRound(players);
          events.push(transition.event);
          barriersChangedTo = true;
          roundStartedRespawnNeeded = true;
          sidesJustSwapped = transition.sidesJustSwapped;
        }
      }
    }

    return {
      events,
      barriersChangedTo,
      roundStartedRespawnNeeded,
      sidesJustSwapped,
      blastKilledUids,
      plantedByUid,
      defusedByUid,
    };
  }

  private enterPostRound(
    players: ReadonlyArray<RoundParticipantState>,
    winnerTeam: TeamId,
    winReason: RoundWinReason,
  ): NetGameEvent {
    if (winnerTeam === 'A') {
      this.scoreA += 1;
    } else {
      this.scoreB += 1;
    }

    this.phase = 'post_round';
    this.phaseRemainingSec = POST_ROUND_SEC;
    this.winnerTeam = winnerTeam;
    this.winReason = winReason;

    if (this.scoreA >= this.roundsToWin || this.scoreB >= this.roundsToWin) {
      this.matchWinnerTeam = this.scoreA >= this.roundsToWin ? 'A' : 'D';
    }

    settleRoundCredits(
      players,
      winnerTeam,
      this.kern.wasPlantedThisRound,
      this.lossStreaks,
    );

    return {
      type: 'round_phase',
      phase: 'post_round',
      roundNumber: this.roundNumber,
      scoreA: this.scoreA,
      scoreB: this.scoreB,
      winnerTeam,
      winReason,
      sidesSwapped: this.sidesSwapped,
      isSuddenDeath: this.isSuddenDeath,
      ...(this.matchWinnerTeam ? { matchWinnerTeam: this.matchWinnerTeam } : {}),
    };
  }

  private advanceToNextRound(players: ReadonlyArray<RoundParticipantState>): {
    event: NetGameEvent;
    sidesJustSwapped: boolean;
  } {
    this.roundNumber += 1;
    this.winnerTeam = undefined;
    this.winReason = undefined;

    let sidesJustSwapped = false;

    // Halftime side swap at start of Round `roundsToWin` (e.g. Round 7 when `roundsToWin === 7`, after 6 rounds!)
    if (this.roundNumber === this.roundsToWin) {
      this.sidesSwapped = !this.sidesSwapped;
      sidesJustSwapped = true;

      const prevScoreA = this.scoreA;
      this.scoreA = this.scoreB;
      this.scoreB = prevScoreA;

      for (const p of players) {
        p.team = p.team === 'A' ? 'D' : 'A';
      }

      resetEconomyForHalftime(players, this.lossStreaks);
    } else if (
      this.scoreA === this.roundsToWin - 1 &&
      this.scoreB === this.roundsToWin - 1
    ) {
      // Sudden Death at 6 : 6 -> everyone gets 5000 Splitter & clean reset
      this.isSuddenDeath = true;
      resetEconomyForSuddenDeath(players, this.lossStreaks);
    } else {
      // Normal round transition: survivors keep weapons/armor; eliminated reset to Funke
      applyNextRoundCarryoverLoadouts(players);
    }

    for (const p of players) {
      p.alive = true;
      p.hp = 100;
    }

    this.phase = 'buy';
    this.phaseRemainingSec = BUY_PHASE_SEC;
    this.barriersActive = true;
    this.bothTeamsPresentAtRoundStart = this.hasBothTeams(players);
    this.kern.resetForRound(players);

    return {
      sidesJustSwapped,
      event: {
        type: 'round_phase',
        phase: 'buy',
        roundNumber: this.roundNumber,
        scoreA: this.scoreA,
        scoreB: this.scoreB,
        sidesSwapped: this.sidesSwapped,
        isSuddenDeath: this.isSuddenDeath,
      },
    };
  }

  private hasBothTeams(players: ReadonlyArray<{ team: TeamId }>): boolean {
    let hasA = false;
    let hasD = false;
    for (const p of players) {
      if (p.team === 'A') hasA = true;
      else if (p.team === 'D') hasD = true;
      if (hasA && hasD) return true;
    }
    return false;
  }

  private countAliveOnTeam(
    players: ReadonlyArray<{ team: TeamId; alive: boolean }>,
    team: TeamId,
  ): number {
    let n = 0;
    for (const p of players) {
      if (p.team === team && p.alive) n += 1;
    }
    return n;
  }

  public toSnapshot(): RoundStateSnapshot {
    return {
      roundNumber: this.roundNumber,
      scoreA: this.scoreA,
      scoreB: this.scoreB,
      phase: this.phase,
      phaseRemainingSec: Math.max(0, this.phaseRemainingSec),
      barriersActive: this.barriersActive,
      sidesSwapped: this.sidesSwapped,
      isSuddenDeath: this.isSuddenDeath,
      ...(this.winnerTeam ? { winnerTeam: this.winnerTeam } : {}),
      ...(this.winReason ? { winReason: this.winReason } : {}),
      ...(this.matchWinnerTeam ? { matchWinnerTeam: this.matchWinnerTeam } : {}),
      kern: this.kern.toSnapshot(),
    };
  }
}
