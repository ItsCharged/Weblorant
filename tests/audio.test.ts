import { afterEach, describe, expect, it, vi } from 'vitest';
import { SynthAudio } from '../src/audio/SynthAudio';
import type { WeaponId } from '../src/core/types';

function createMockAudioContextClass(options: { withConvolver?: boolean; withPanner?: boolean } = {}) {
  const { withConvolver = true, withPanner = true } = options;

  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });

  const makeNode = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  return class MockAudioContext {
    public sampleRate = 48000;
    public currentTime = 1.0;
    public state: AudioContextState = 'running';
    public destination = makeNode();

    public createGain() {
      return { ...makeNode(), gain: makeParam(1) };
    }
    public createBuffer(channels: number, length: number, _sampleRate: number) {
      const channelData = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        getChannelData: (ch: number) => channelData[ch],
      };
    }
    public createBufferSource() {
      return { ...makeNode(), buffer: null as unknown, start: vi.fn(), stop: vi.fn() };
    }
    public createBiquadFilter() {
      return { ...makeNode(), type: 'lowpass', frequency: makeParam(1000), Q: makeParam(1) };
    }
    public createOscillator() {
      return { ...makeNode(), type: 'sine', frequency: makeParam(440), start: vi.fn(), stop: vi.fn() };
    }
    public createDelay() {
      return { ...makeNode(), delayTime: makeParam(0) };
    }
    public createConvolver = withConvolver
      ? () => ({ ...makeNode(), buffer: null as unknown })
      : undefined;
    public createStereoPanner = withPanner
      ? () => ({ ...makeNode(), pan: makeParam(0) })
      : undefined;
    public resume = vi.fn().mockResolvedValue(undefined);
  };
}

describe('SynthAudio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is completely safe in headless/test environments without window or AudioContext', () => {
    const audio = new SynthAudio(0.5);
    expect(audio.getVolume()).toBe(0.5);
    audio.setVolume(0.8);
    expect(audio.getVolume()).toBe(0.8);
    audio.setReverbMix(0.35);

    expect(() => {
      audio.resume();
      audio.playShot('lanze');
      audio.playRemoteShot('falke', { x: 0, y: 0, z: 0 }, 0, { x: 10, y: 0, z: 10 });
      audio.playMeleeSlash();
      audio.playHit('head', true);
      audio.playDamageTaken();
      audio.playReload();
      audio.playFootstep();
      audio.playRemoteFootstep({ x: 0, y: 0, z: 0 }, 0, { x: 4, y: 0, z: 4 });
      audio.updateKernFuseAudio(true, 12, 0.5);
      audio.playKernPlantStart();
      audio.playKernPlanted();
      audio.playKernDefuseStart();
      audio.playKernHalfDefused();
      audio.playKernDefused();
      audio.playKernDetonated();
      audio.playBuySuccess();
      audio.playBuyError();
      audio.playBuyMenuOpen(true);
      audio.playUiBeep(true);
      audio.playUiHover();
      audio.playPingSound('danger');
      audio.playAbilityCast('ryo', 'q');
      audio.playMineTrigger();
      audio.playBarrierHit();
    }).not.toThrow();
  });

  it('initializes procedural ConvolverNode reverb and synthesizes all 6 weapons + UI sounds', () => {
    const MockCtx = createMockAudioContextClass({ withConvolver: true, withPanner: true });
    vi.stubGlobal('window', { AudioContext: MockCtx });

    const audio = new SynthAudio(0.7);
    audio.setReverbMix(0.3);

    const weapons: WeaponId[] = ['funke', 'bolzer', 'hornisse', 'lanze', 'brecher', 'falke'];
    for (const w of weapons) {
      expect(() => audio.playShot(w)).not.toThrow();
      expect(() =>
        audio.playRemoteShot(w, { x: 0, y: 1.7, z: 0 }, 0.4, { x: 15, y: 1.7, z: -20 })
      ).not.toThrow();
    }

    expect(() => {
      audio.playBuySuccess();
      audio.playBuyError();
      audio.playBuyMenuOpen(true);
      audio.playBuyMenuOpen(false);
      audio.playUiBeep(true);
      audio.playUiBeep(false);
      audio.playUiHover();
      audio.playPingSound('danger');
      audio.playPingSound('assist');
      audio.playKernDetonated();
    }).not.toThrow();
  });

  it('falls back cleanly when ConvolverNode and StereoPannerNode are unavailable', () => {
    const MockCtx = createMockAudioContextClass({ withConvolver: false, withPanner: false });
    vi.stubGlobal('window', { AudioContext: MockCtx });

    const audio = new SynthAudio(0.6);
    expect(() => {
      audio.playShot('falke');
      audio.playRemoteShot('brecher', { x: 0, y: 0, z: 0 }, 0, { x: 8, y: 0, z: 8 });
      audio.playBuySuccess();
    }).not.toThrow();
  });
});
