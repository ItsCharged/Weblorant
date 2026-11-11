import type { NetSimConfig } from '../core/types';

export const WEBRTC_FALLBACK_TIMEOUT_MS = 8000;
export const HOST_SNAPSHOT_HZ_P2P = 20;
export const HOST_SNAPSHOT_HZ_RELAY = 10;
export const CLIENT_INPUT_HZ_RELAY = 10;
export const PING_INTERVAL_MS = 1000;

export const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';

export const DEFAULT_NET_SIM: NetSimConfig = {
  enabled: false,
  latencyMs: 0,
  jitterMs: 0,
  packetLossPct: 0,
  forceRelay: false,
};

/**
 * Builds the WebRTC ICE server list from Vite environment variables.
 * Never hardcodes TURN secrets.
 */
export function getIceServers(): RTCIceServer[] {
  const env = import.meta.env ?? {};
  const rawStun = env.VITE_ICE_STUN_URL?.trim();
  const stunUrls = rawStun
    ? rawStun
        .split(',')
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
    : [DEFAULT_STUN_URL];

  const servers: RTCIceServer[] = [
    {
      urls: stunUrls.length === 1 ? stunUrls[0] : stunUrls,
    },
  ];

  const turnUrl = env.VITE_ICE_TURN_URL?.trim();
  if (turnUrl) {
    const turnUrls = turnUrl
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    const turnEntry: RTCIceServer = {
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
    };
    const username = env.VITE_ICE_TURN_USERNAME?.trim();
    const credential = env.VITE_ICE_TURN_CREDENTIAL?.trim();
    if (username) {
      turnEntry.username = username;
    }
    if (credential) {
      turnEntry.credential = credential;
    }
    servers.push(turnEntry);
  }

  return servers;
}
