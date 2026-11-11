import {
  type Database,
  get,
  onDisconnect,
  onValue,
  ref,
  set,
  update,
} from 'firebase/database';
import type { RoomStatus } from '../core/types';

const HEARTBEAT_INTERVAL_MS = 20_000;

export interface DetachPresenceFn {
  (): Promise<void>;
  syncStatus: (status: RoomStatus) => Promise<void>;
}

/**
 * Attaches Realtime Database `.info/connected` presence and `onDisconnect` handlers for a room participant:
 * - While in `'lobby'`, unexpected tab close removes `rooms/{code}/players/{uid}` immediately.
 * - While in `'playing'`, unexpected tab close marks `{ online: false, ready: false }` so match state stays intact.
 * - If `isHost === true`, unexpected tab close also marks `rooms/{code}/status = 'ended'` so guests are notified immediately.
 * - Sends a 20s `lastActive` heartbeat while connected so active rooms never become stale.
 */
export function attachRoomPresence(
  db: Database,
  code: string,
  uid: string,
  isHost: boolean,
  getRoomStatus: () => RoomStatus,
): DetachPresenceFn {
  const connectedRef = ref(db, '.info/connected');
  const playerRef = ref(db, `rooms/${code}/players/${uid}`);
  const roomStatusRef = ref(db, `rooms/${code}/status`);
  const lastActiveRef = ref(db, `rooms/${code}/lastActive`);

  let detached = false;
  let isConnected = false;

  const configureDisconnectHandlers = async (status: RoomStatus): Promise<void> => {
    if (detached || !isConnected) return;

    try {
      await onDisconnect(playerRef).cancel();
      if (detached) return;

      if (status === 'lobby') {
        await onDisconnect(playerRef).remove();
      } else {
        await onDisconnect(playerRef).update({ online: false, ready: false });
      }

      if (isHost && !detached) {
        await onDisconnect(roomStatusRef).set('ended');
      }
    } catch {
      // Ignore transient disconnect-registration errors if room closed concurrently
    }
  };

  const unsubscribeConnected = onValue(connectedRef, (snap) => {
    const connected = snap.val() === true;
    isConnected = connected;
    if (!connected || detached) return;

    void (async () => {
      await configureDisconnectHandlers(getRoomStatus());
      if (detached) return;

      try {
        const playerSnap = await get(playerRef);
        if (!detached && playerSnap.exists()) {
          await update(playerRef, { online: true });
          await set(lastActiveRef, Date.now());
        }
      } catch {
        // Ignore if player left concurrently
      }
    })();
  });

  const heartbeatTimer = setInterval(() => {
    if (detached || !isConnected) return;
    void set(lastActiveRef, Date.now()).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  const detach = (async (): Promise<void> => {
    if (detached) return;
    detached = true;
    isConnected = false;
    clearInterval(heartbeatTimer);
    unsubscribeConnected();

    await Promise.allSettled([
      onDisconnect(playerRef).cancel(),
      isHost ? onDisconnect(roomStatusRef).cancel() : Promise.resolve(),
    ]);
  }) as DetachPresenceFn;

  detach.syncStatus = async (status: RoomStatus): Promise<void> => {
    await configureDisconnectHandlers(status);
  };

  return detach;
}
