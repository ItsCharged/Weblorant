import type { AbilitySlot, CharacterId, Vec3, WeaponId } from '../core/types';

interface SpatialGainAndPan {
  outputNode: AudioNode;
  attenuation: number;
  lowpassHz: number;
}

export class SynthAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.65;
  private kernBeepTimer = 0;
  private wasKernPlantedActive = false;

  constructor(initialVolume = 0.65) {
    this.volume = Math.max(0, Math.min(1, initialVolume));
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.buildNoiseBuffer(this.ctx, 1.2);
    }
    return this.ctx;
  }

  private buildNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x5f3759df;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }

  public resume(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // Ignore autoplay restrictions before user gesture
      });
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  private createSpatialChain(
    ctx: AudioContext,
    listenerPos: Vec3,
    listenerYaw: number,
    sourcePos: Vec3,
    maxDistanceM: number,
    refDistanceM: number
  ): SpatialGainAndPan | null {
    if (!this.masterGain) return null;

    const dx = sourcePos.x - listenerPos.x;
    const dy = sourcePos.y - listenerPos.y;
    const dz = sourcePos.z - listenerPos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDistanceM) return null;

    const clampedDist = Math.max(refDistanceM, dist);
    const norm = Math.max(
      0,
      1 - (clampedDist - refDistanceM) / Math.max(0.01, maxDistanceM - refDistanceM)
    );
    const attenuation = norm * norm;
    if (attenuation <= 0.002) return null;

    // Listener forward = (-sin(yaw), 0, -cos(yaw)) -> right = (cos(yaw), 0, -sin(yaw))
    const horizDist = Math.hypot(dx, dz);
    const rightDot =
      horizDist > 0.05 ? (dx * Math.cos(listenerYaw) - dz * Math.sin(listenerYaw)) / horizDist : 0;
    const pan = Math.max(-0.94, Math.min(0.94, rightDot));

    const lowpassHz = Math.round(900 + norm * 3800);

    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, ctx.currentTime);
      panner.connect(this.masterGain);
      return { outputNode: panner, attenuation, lowpassHz };
    }

    return { outputNode: this.masterGain, attenuation, lowpassHz };
  }

  public playShot(weaponId: WeaponId): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') return;

    this.triggerWeaponShotGraph(ctx, weaponId, this.masterGain, 1.0, 5200);
  }

  public playRemoteShot(
    weaponId: WeaponId,
    listenerPos: Vec3,
    listenerYaw: number,
    sourcePos: Vec3
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') return;

    const spatial = this.createSpatialChain(ctx, listenerPos, listenerYaw, sourcePos, 95, 5.5);
    if (!spatial) return;

    this.triggerWeaponShotGraph(
      ctx,
      weaponId,
      spatial.outputNode,
      spatial.attenuation * 0.88,
      spatial.lowpassHz
    );
  }

  private triggerWeaponShotGraph(
    ctx: AudioContext,
    weaponId: WeaponId,
    destination: AudioNode,
    gainScale: number,
    maxCutoffHz: number
  ): void {
    if (!this.noiseBuffer) return;
    const now = ctx.currentTime;

    // Distinct procedural synthesis profile for each of the 6 SHARDLINE weapons
    let bodyStartHz = 172;
    let bodyEndHz = 45;
    let bodyDuration = 0.135;
    let bodyWave: OscillatorType = 'triangle';
    let noiseCutoffHz = 2550;
    let noiseQ = 0.85;
    let noiseDuration = 0.115;
    let punchGain = 0.44;
    let crackHz = 960;
    let crackWave: OscillatorType = 'sawtooth';

    switch (weaponId) {
      case 'funke':
        // Light crisp sidearm snap
        bodyStartHz = 255;
        bodyEndHz = 78;
        bodyDuration = 0.075;
        bodyWave = 'triangle';
        noiseCutoffHz = 3400;
        noiseQ = 1.15;
        noiseDuration = 0.068;
        punchGain = 0.29;
        crackHz = 1420;
        crackWave = 'triangle';
        break;
      case 'bolzer':
        // Heavy revolver/hand-cannon punch
        bodyStartHz = 142;
        bodyEndHz = 34;
        bodyDuration = 0.21;
        bodyWave = 'sawtooth';
        noiseCutoffHz = 1900;
        noiseQ = 0.72;
        noiseDuration = 0.18;
        punchGain = 0.56;
        crackHz = 760;
        crackWave = 'sawtooth';
        break;
      case 'hornisse':
        // Rapid high-RPM SMG buzz-pop
        bodyStartHz = 225;
        bodyEndHz = 66;
        bodyDuration = 0.064;
        bodyWave = 'square';
        noiseCutoffHz = 3050;
        noiseQ = 1.25;
        noiseDuration = 0.058;
        punchGain = 0.25;
        crackHz = 1220;
        crackWave = 'square';
        break;
      case 'brecher':
        // Wide cavernous 8-pellet shotgun boom
        bodyStartHz = 108;
        bodyEndHz = 26;
        bodyDuration = 0.28;
        bodyWave = 'triangle';
        noiseCutoffHz = 1520;
        noiseQ = 0.55;
        noiseDuration = 0.25;
        punchGain = 0.62;
        crackHz = 560;
        crackWave = 'sawtooth';
        break;
      case 'falke':
        // Thunderous high-caliber precision crack + long tail
        bodyStartHz = 132;
        bodyEndHz = 24;
        bodyDuration = 0.38;
        bodyWave = 'sawtooth';
        noiseCutoffHz = 2650;
        noiseQ = 0.65;
        noiseDuration = 0.34;
        punchGain = 0.7;
        crackHz = 1680;
        crackWave = 'sawtooth';
        break;
      case 'lanze':
      default:
        // Balanced crisp assault rifle bark
        bodyStartHz = 172;
        bodyEndHz = 45;
        bodyDuration = 0.135;
        bodyWave = 'triangle';
        noiseCutoffHz = 2550;
        noiseQ = 0.85;
        noiseDuration = 0.115;
        punchGain = 0.44;
        crackHz = 960;
        crackWave = 'sawtooth';
        break;
    }

    const scaledGain = Math.max(0.002, punchGain * gainScale);
    const effNoiseCutoff = Math.min(noiseCutoffHz, maxCutoffHz);

    // 1. Filtered white-noise blast transient
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(effNoiseCutoff, now);
    bandpass.frequency.exponentialRampToValueAtTime(
      Math.min(380, effNoiseCutoff),
      now + noiseDuration
    );
    bandpass.Q.value = noiseQ;

    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.001, now);
    noiseEnv.gain.linearRampToValueAtTime(scaledGain, now + 0.003);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + noiseDuration);

    noiseSrc.connect(bandpass);
    bandpass.connect(noiseEnv);
    noiseEnv.connect(destination);

    noiseSrc.start(now);
    noiseSrc.stop(now + noiseDuration + 0.02);

    // 2. Pitch-dropping low-end receiver thump
    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = bodyWave;
    bodyOsc.frequency.setValueAtTime(bodyStartHz, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(bodyEndHz, now + bodyDuration);

    const bodyEnv = ctx.createGain();
    bodyEnv.gain.setValueAtTime(scaledGain * 0.92, now);
    bodyEnv.gain.exponentialRampToValueAtTime(0.001, now + bodyDuration);

    bodyOsc.connect(bodyEnv);
    bodyEnv.connect(destination);
    bodyOsc.start(now);
    bodyOsc.stop(now + bodyDuration + 0.02);

    // 3. Supersonic / mechanical muzzle snap
    const snapOsc = ctx.createOscillator();
    snapOsc.type = crackWave;
    snapOsc.frequency.setValueAtTime(Math.min(crackHz, maxCutoffHz), now);
    snapOsc.frequency.exponentialRampToValueAtTime(210, now + 0.032);

    const snapEnv = ctx.createGain();
    snapEnv.gain.setValueAtTime(scaledGain * 0.45, now);
    snapEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    snapOsc.connect(snapEnv);
    snapEnv.connect(destination);
    snapOsc.start(now);
    snapOsc.stop(now + 0.04);
  }

  public playMeleeSlash(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;

    // Air whoosh
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(650, now);
    bp.frequency.exponentialRampToValueAtTime(2200, now + 0.06);
    bp.frequency.exponentialRampToValueAtTime(480, now + 0.14);
    bp.Q.value = 1.6;

    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(0.001, now);
    nEnv.gain.linearRampToValueAtTime(0.24, now + 0.035);
    nEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    noise.connect(bp);
    bp.connect(nEnv);
    nEnv.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.16);

    // Metallic titanium blade shimmer
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(2680, now + 0.015);
    ring.frequency.exponentialRampToValueAtTime(3420, now + 0.09);

    const rEnv = ctx.createGain();
    rEnv.gain.setValueAtTime(0.001, now + 0.015);
    rEnv.gain.linearRampToValueAtTime(0.09, now + 0.025);
    rEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    ring.connect(rEnv);
    rEnv.connect(this.masterGain);
    ring.start(now + 0.015);
    ring.stop(now + 0.13);
  }

  public playHit(zone: 'head' | 'body', killed: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;

    if (zone === 'head') {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1880, now);
      osc1.frequency.exponentialRampToValueAtTime(2420, now + 0.045);

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(3760, now);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.36, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc1.connect(env);
      osc2.connect(env);
      env.connect(this.masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.15);
      osc2.stop(now + 0.15);
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.045);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.28, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(env);
      env.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.055);
    }

    if (killed) {
      const notes = [587.33, 880.0];
      notes.forEach((freq, idx) => {
        const start = now + 0.025 + idx * 0.035;
        const kOsc = ctx.createOscillator();
        kOsc.type = 'triangle';
        kOsc.frequency.setValueAtTime(freq, start);

        const kEnv = ctx.createGain();
        kEnv.gain.setValueAtTime(0.001, start);
        kEnv.gain.linearRampToValueAtTime(0.24, start + 0.008);
        kEnv.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

        kOsc.connect(kEnv);
        if (this.masterGain) {
          kEnv.connect(this.masterGain);
        }
        kOsc.start(start);
        kOsc.stop(start + 0.24);
      });
    }
  }

  public playDamageTaken(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.15);

    const oscEnv = ctx.createGain();
    oscEnv.gain.setValueAtTime(0.45, now);
    oscEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(oscEnv);
    oscEnv.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(520, now);
    filter.Q.value = 1.2;

    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(0.001, now);
    nEnv.gain.linearRampToValueAtTime(0.28, now + 0.004);
    nEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

    noise.connect(filter);
    filter.connect(nEnv);
    nEnv.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.085);
  }

  public playReload(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    this.scheduleMechanicalClick(ctx, now, 780, 340, 0.045, 0.2);
    this.scheduleMechanicalClick(ctx, now + 0.42, 460, 980, 0.06, 0.24);
    this.scheduleMechanicalClick(ctx, now + 0.88, 620, 1240, 0.055, 0.2);
  }

  private scheduleMechanicalClick(
    ctx: AudioContext,
    startTime: number,
    fStart: number,
    fEnd: number,
    dur: number,
    peakGain: number
  ): void {
    if (!this.masterGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(fStart, startTime);
    osc.frequency.exponentialRampToValueAtTime(fEnd, startTime + dur);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 1.6;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, startTime);
    env.gain.linearRampToValueAtTime(peakGain, startTime + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

    osc.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);

    osc.start(startTime);
    osc.stop(startTime + dur + 0.01);
  }

  public playFootstep(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') return;

    this.triggerFootstepGraph(ctx, this.masterGain, 0.14);
  }

  public playRemoteFootstep(listenerPos: Vec3, listenerYaw: number, sourcePos: Vec3): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') return;

    const spatial = this.createSpatialChain(ctx, listenerPos, listenerYaw, sourcePos, 24, 2.2);
    if (!spatial) return;

    this.triggerFootstepGraph(ctx, spatial.outputNode, 0.22 * spatial.attenuation);
  }

  private triggerFootstepGraph(
    ctx: AudioContext,
    destination: AudioNode,
    peakGain: number
  ): void {
    if (!this.noiseBuffer || peakGain <= 0.001) return;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(380, now);
    lp.frequency.exponentialRampToValueAtTime(115, now + 0.068);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

    noise.connect(lp);
    lp.connect(env);
    env.connect(destination);

    noise.start(now);
    noise.stop(now + 0.085);
  }

  /**
   * Accelerating sci-fi Kern pulse beep:
   * - 40s..20s: 1 beep/s
   * - 20s..10s: 2 beeps/s
   * - 10s..5s:  4 beeps/s
   * - 5s..0s:   8 beeps/s
   */
  public updateKernFuseAudio(
    plantedActive: boolean,
    fuseRemainingSec: number,
    frameDt: number,
    listenerPos?: Vec3,
    listenerYaw?: number,
    kernPos?: Vec3
  ): void {
    if (!plantedActive || fuseRemainingSec <= 0) {
      this.wasKernPlantedActive = false;
      this.kernBeepTimer = 0;
      return;
    }

    if (!this.wasKernPlantedActive) {
      this.wasKernPlantedActive = true;
      this.kernBeepTimer = 0.25;
    }

    let intervalSec = 1.0;
    if (fuseRemainingSec <= 5.0) {
      intervalSec = 0.125; // 8 beeps/s
    } else if (fuseRemainingSec <= 10.0) {
      intervalSec = 0.25; // 4 beeps/s
    } else if (fuseRemainingSec <= 20.0) {
      intervalSec = 0.5; // 2 beeps/s
    }

    this.kernBeepTimer -= frameDt;
    if (this.kernBeepTimer <= 0) {
      this.kernBeepTimer = intervalSec;
      const urgency01 = Math.max(0, Math.min(1, 1 - fuseRemainingSec / 40));
      this.playKernBeep(urgency01, listenerPos, listenerYaw, kernPos);
    }
  }

  public playKernBeep(
    urgency01: number,
    listenerPos?: Vec3,
    listenerYaw?: number,
    sourcePos?: Vec3
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    let destination: AudioNode = this.masterGain;
    let gainScale = 1.0;
    if (listenerPos && listenerYaw !== undefined && sourcePos) {
      const spatial = this.createSpatialChain(ctx, listenerPos, listenerYaw, sourcePos, 115, 10);
      if (!spatial) return;
      destination = spatial.outputNode;
      gainScale = Math.max(0.22, spatial.attenuation);
    }

    const u = Math.max(0, Math.min(1, urgency01));
    const now = ctx.currentTime;
    const baseFreq = 1120 + u * 540;
    const dur = 0.068 - u * 0.018;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.08, now + dur);

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(baseFreq * 0.5, now);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime((0.22 + u * 0.14) * gainScale, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur + 0.02);

    osc.connect(env);
    sub.connect(env);
    env.connect(destination);

    osc.start(now);
    sub.start(now);
    osc.stop(now + dur + 0.03);
    sub.stop(now + dur + 0.03);
  }

  public playKernPlantStart(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.24);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.2, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(lp);
    lp.connect(env);
    env.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  public playKernPlanted(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;

    // Dramatic deep industrial synth horn
    const horn1 = ctx.createOscillator();
    horn1.type = 'sawtooth';
    horn1.frequency.setValueAtTime(110, now);
    horn1.frequency.exponentialRampToValueAtTime(82.41, now + 0.65);

    const horn2 = ctx.createOscillator();
    horn2.type = 'triangle';
    horn2.frequency.setValueAtTime(55, now);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(920, now);
    lp.frequency.exponentialRampToValueAtTime(260, now + 0.7);

    const hEnv = ctx.createGain();
    hEnv.gain.setValueAtTime(0.001, now);
    hEnv.gain.linearRampToValueAtTime(0.38, now + 0.04);
    hEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.72);

    horn1.connect(lp);
    horn2.connect(lp);
    lp.connect(hEnv);
    hEnv.connect(this.masterGain);

    horn1.start(now);
    horn2.start(now);
    horn1.stop(now + 0.75);
    horn2.stop(now + 0.75);

    // High amber warning chime
    const chime = ctx.createOscillator();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(1318.5, now + 0.04);
    chime.frequency.setValueAtTime(987.77, now + 0.2);

    const cEnv = ctx.createGain();
    cEnv.gain.setValueAtTime(0.001, now + 0.04);
    cEnv.gain.linearRampToValueAtTime(0.24, now + 0.055);
    cEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    chime.connect(cEnv);
    cEnv.connect(this.masterGain);
    chime.start(now + 0.04);
    chime.stop(now + 0.52);
  }

  public playKernDefuseStart(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    [740, 1108.73].forEach((freq, idx) => {
      const t = now + idx * 0.055;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, t);
      env.gain.linearRampToValueAtTime(0.22, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      osc.connect(env);
      if (this.masterGain) env.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  }

  public playKernHalfDefused(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1480, now);
    osc.frequency.exponentialRampToValueAtTime(1975.5, now + 0.09);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.26, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(env);
    env.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  public playKernDefused(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    // Bright triumphant cyan resolution chord (D major9 feel)
    const chord = [587.33, 739.99, 880.0, 1174.66];
    chord.forEach((freq, idx) => {
      const start = now + idx * 0.045;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, start);
      env.gain.linearRampToValueAtTime(0.2, start + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, start + 0.65);

      osc.connect(env);
      if (this.masterGain) env.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.68);
    });
  }

  public playKernDetonated(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;

    // Sub-bass shockwave drop
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(135, now);
    sub.frequency.exponentialRampToValueAtTime(22, now + 1.05);

    const subEnv = ctx.createGain();
    subEnv.gain.setValueAtTime(0.001, now);
    subEnv.gain.linearRampToValueAtTime(0.68, now + 0.018);
    subEnv.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

    sub.connect(subEnv);
    subEnv.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 1.15);

    // Rumbling explosion noise tail
    const roar = ctx.createBufferSource();
    roar.buffer = this.noiseBuffer;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1650, now);
    lp.frequency.exponentialRampToValueAtTime(140, now + 1.1);

    const rEnv = ctx.createGain();
    rEnv.gain.setValueAtTime(0.001, now);
    rEnv.gain.linearRampToValueAtTime(0.55, now + 0.02);
    rEnv.gain.exponentialRampToValueAtTime(0.001, now + 1.12);

    roar.connect(lp);
    lp.connect(rEnv);
    rEnv.connect(this.masterGain);
    roar.start(now);
    roar.stop(now + 1.15);
  }

  public playBuySuccess(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    this.scheduleMechanicalClick(ctx, now, 680, 1280, 0.045, 0.2);

    const chime = ctx.createOscillator();
    chime.type = 'sine';
    chime.frequency.setValueAtTime(1174.66, now + 0.025);
    chime.frequency.exponentialRampToValueAtTime(1567.98, now + 0.11);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now + 0.025);
    env.gain.linearRampToValueAtTime(0.22, now + 0.035);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    chime.connect(env);
    env.connect(this.masterGain);
    chime.start(now + 0.025);
    chime.stop(now + 0.16);
  }

  public playBuyError(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    [0, 0.08].forEach((offset) => {
      const t = now + offset;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(195, t);
      osc.frequency.linearRampToValueAtTime(155, t + 0.06);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 650;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, t);
      env.gain.linearRampToValueAtTime(0.22, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.065);

      osc.connect(lp);
      lp.connect(env);
      if (this.masterGain) env.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.07);
    });
  }

  public playAbilityCast(character: CharacterId, slot: AbilitySlot): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;

    if (character === 'ryo') {
      if (slot === 'q') {
        // Gleitschritt: rapid kinetic thruster whoosh
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1600, now);
        bp.frequency.exponentialRampToValueAtTime(380, now + 0.19);
        bp.Q.value = 1.4;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.4, now + 0.02);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
        src.connect(bp);
        bp.connect(env);
        env.connect(this.masterGain);
        src.start(now);
        src.stop(now + 0.22);
      } else if (slot === 'e') {
        // Adrenalin: crisp rising bio-stim injector chirp
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(1420, now + 0.16);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.26, now + 0.015);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(env);
        env.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.2);
      } else {
        // Überlast: twin-oscillator power-core surge
        [220, 440, 659.25].forEach((freq, idx) => {
          const t = now + idx * 0.04;
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, t);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.34);
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 1800;
          const env = ctx.createGain();
          env.gain.setValueAtTime(0.001, t);
          env.gain.linearRampToValueAtTime(0.18, t + 0.02);
          env.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
          osc.connect(lp);
          lp.connect(env);
          if (this.masterGain) env.connect(this.masterGain);
          osc.start(t);
          osc.stop(t + 0.4);
        });
      }
      return;
    }

    if (character === 'mira') {
      if (slot === 'q') {
        // Echo-Puls: crystalline sonar ping
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1480, now);
        osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.28);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.3, now + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.connect(env);
        env.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.34);
      } else if (slot === 'e') {
        // Störsender: modulated electromagnetic disruption pulse
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(130, now + 0.24);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1050;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.24, now + 0.012);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.connect(lp);
        lp.connect(env);
        env.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.28);
      } else {
        // Weitblick: deep orbital radar sweep
        [880, 1318.51].forEach((freq, idx) => {
          const t = now + idx * 0.09;
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t);
          const env = ctx.createGain();
          env.gain.setValueAtTime(0.001, t);
          env.gain.linearRampToValueAtTime(0.26, t + 0.02);
          env.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          osc.connect(env);
          if (this.masterGain) env.connect(this.masterGain);
          osc.start(t);
          osc.stop(t + 0.58);
        });
      }
      return;
    }

    if (character === 'brann') {
      if (slot === 'q' || slot === 'x') {
        // Nebelkuppel / Dunkelzone: pressurized industrial smoke release
        const dur = slot === 'x' ? 0.52 : 0.32;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(slot === 'x' ? 720 : 980, now);
        lp.frequency.exponentialRampToValueAtTime(220, now + dur);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.36, now + 0.03);
        env.gain.exponentialRampToValueAtTime(0.001, now + dur);
        src.connect(lp);
        lp.connect(env);
        env.connect(this.masterGain);
        src.start(now);
        src.stop(now + dur + 0.02);
      } else {
        // Glutfeld: thermal ignition flare
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(840, now);
        bp.frequency.exponentialRampToValueAtTime(1650, now + 0.24);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.32, now + 0.02);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        src.connect(bp);
        bp.connect(env);
        env.connect(this.masterGain);
        src.start(now);
        src.stop(now + 0.3);
      }
      return;
    }

    // Tessa Vahl
    if (slot === 'q') {
      // Magnetanker: magnetic anchor latch
      this.scheduleMechanicalClick(ctx, now, 860, 1480, 0.055, 0.24);
    } else if (slot === 'e') {
      // Schildpfosten: heavy energy barrier lock-in
      this.scheduleMechanicalClick(ctx, now, 320, 740, 0.09, 0.28);
      const hum = ctx.createOscillator();
      hum.type = 'triangle';
      hum.frequency.setValueAtTime(196, now + 0.03);
      hum.frequency.exponentialRampToValueAtTime(392, now + 0.22);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, now + 0.03);
      env.gain.linearRampToValueAtTime(0.22, now + 0.05);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      hum.connect(env);
      env.connect(this.masterGain);
      hum.start(now + 0.03);
      hum.stop(now + 0.28);
    } else {
      // Bollwerk: resonant protective harmonic field
      [392.0, 587.33, 783.99].forEach((freq, idx) => {
        const t = now + idx * 0.04;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, t);
        env.gain.linearRampToValueAtTime(0.22, t + 0.025);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        osc.connect(env);
        if (this.masterGain) env.connect(this.masterGain);
        osc.start(t);
        osc.stop(t + 0.58);
      });
    }
  }

  public playMineTrigger(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    [1320, 1760, 880].forEach((freq, idx) => {
      const t = now + idx * 0.045;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, t);
      env.gain.linearRampToValueAtTime(0.24, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      osc.connect(lp);
      lp.connect(env);
      if (this.masterGain) env.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  }

  public playBarrierHit(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.075);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.25, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(env);
    env.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  public playUiBeep(active = true): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const baseFreq = active ? 1040 : 680;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(active ? 1380 : 520, now + 0.055);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.22, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    osc.connect(env);
    env.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.075);
  }
}
