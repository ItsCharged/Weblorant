import {
  type Database,
  onChildAdded,
  onValue,
  push,
  ref,
  remove,
  set,
} from 'firebase/database';

export interface SignalingSdpMessage {
  sessionId: string;
  type: 'offer' | 'answer';
  sdp: string;
  createdAt: number;
}

export interface SignalingIceMessage {
  sessionId: string;
  candidate: RTCIceCandidateInit;
}

function sanitizeIceCandidate(raw: RTCIceCandidateInit): RTCIceCandidateInit {
  const cleaned: RTCIceCandidateInit = {
    candidate: raw.candidate ?? '',
  };
  if (raw.sdpMid !== undefined && raw.sdpMid !== null) {
    cleaned.sdpMid = raw.sdpMid;
  }
  if (raw.sdpMLineIndex !== undefined && raw.sdpMLineIndex !== null) {
    cleaned.sdpMLineIndex = raw.sdpMLineIndex;
  }
  if (raw.usernameFragment !== undefined && raw.usernameFragment !== null) {
    cleaned.usernameFragment = raw.usernameFragment;
  }
  return cleaned;
}

export function createSignalingSessionId(uid: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${uid}_${Date.now()}_${rand}`;
}

/**
 * Scoped RTDB signaling channel helper for a single (roomCode, peerUid) star link
 * at `rooms/{code}/signaling/{peerUid}`.
 */
export class PeerSignalingChannel {
  private readonly db: Database;
  private readonly basePath: string;

  constructor(db: Database, roomCode: string, peerUid: string) {
    this.db = db;
    this.basePath = `rooms/${roomCode}/signaling/${peerUid}`;
  }

  public async clearAll(): Promise<void> {
    await remove(ref(this.db, this.basePath));
  }

  public async clearHostCandidates(): Promise<void> {
    await remove(ref(this.db, `${this.basePath}/candidatesFromHost`));
  }

  public async writeOffer(sessionId: string, sdp: string): Promise<void> {
    const payload: SignalingSdpMessage = {
      sessionId,
      type: 'offer',
      sdp,
      createdAt: Date.now(),
    };
    await set(ref(this.db, `${this.basePath}/offer`), payload);
  }

  public async writeAnswer(sessionId: string, sdp: string): Promise<void> {
    const payload: SignalingSdpMessage = {
      sessionId,
      type: 'answer',
      sdp,
      createdAt: Date.now(),
    };
    await set(ref(this.db, `${this.basePath}/answer`), payload);
  }

  public async pushPeerCandidate(
    sessionId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    if (!candidate.candidate) return;
    const msg: SignalingIceMessage = {
      sessionId,
      candidate: sanitizeIceCandidate(candidate),
    };
    await push(ref(this.db, `${this.basePath}/candidatesFromPeer`), msg);
  }

  public async pushHostCandidate(
    sessionId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    if (!candidate.candidate) return;
    const msg: SignalingIceMessage = {
      sessionId,
      candidate: sanitizeIceCandidate(candidate),
    };
    await push(ref(this.db, `${this.basePath}/candidatesFromHost`), msg);
  }

  public onOffer(handler: (msg: SignalingSdpMessage) => void): () => void {
    const offerRef = ref(this.db, `${this.basePath}/offer`);
    return onValue(offerRef, (snap) => {
      const val = snap.val() as Partial<SignalingSdpMessage> | null;
      if (
        val &&
        typeof val.sessionId === 'string' &&
        val.type === 'offer' &&
        typeof val.sdp === 'string'
      ) {
        handler({
          sessionId: val.sessionId,
          type: 'offer',
          sdp: val.sdp,
          createdAt: typeof val.createdAt === 'number' ? val.createdAt : 0,
        });
      }
    });
  }

  public onAnswer(handler: (msg: SignalingSdpMessage) => void): () => void {
    const answerRef = ref(this.db, `${this.basePath}/answer`);
    return onValue(answerRef, (snap) => {
      const val = snap.val() as Partial<SignalingSdpMessage> | null;
      if (
        val &&
        typeof val.sessionId === 'string' &&
        val.type === 'answer' &&
        typeof val.sdp === 'string'
      ) {
        handler({
          sessionId: val.sessionId,
          type: 'answer',
          sdp: val.sdp,
          createdAt: typeof val.createdAt === 'number' ? val.createdAt : 0,
        });
      }
    });
  }

  public onPeerCandidate(handler: (msg: SignalingIceMessage) => void): () => void {
    const listRef = ref(this.db, `${this.basePath}/candidatesFromPeer`);
    return onChildAdded(listRef, (snap) => {
      const val = snap.val() as Partial<SignalingIceMessage> | null;
      if (
        val &&
        typeof val.sessionId === 'string' &&
        val.candidate &&
        typeof val.candidate.candidate === 'string'
      ) {
        handler({
          sessionId: val.sessionId,
          candidate: val.candidate,
        });
      }
    });
  }

  public onHostCandidate(handler: (msg: SignalingIceMessage) => void): () => void {
    const listRef = ref(this.db, `${this.basePath}/candidatesFromHost`);
    return onChildAdded(listRef, (snap) => {
      const val = snap.val() as Partial<SignalingIceMessage> | null;
      if (
        val &&
        typeof val.sessionId === 'string' &&
        val.candidate &&
        typeof val.candidate.candidate === 'string'
      ) {
        handler({
          sessionId: val.sessionId,
          candidate: val.candidate,
        });
      }
    });
  }
}
