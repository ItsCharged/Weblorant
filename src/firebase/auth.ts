import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  configureAuthSessionPersistence,
  getFirebaseServices,
  isFirebaseConfigured,
} from './init';
import { isValidPlayerName, sanitizePlayerName } from './roomCode';

const PLAYER_NAME_STORAGE_KEY = 'shardline_player_name';

let pendingAuthPromise: Promise<{ uid: string }> | null = null;

async function waitForInitialUser(
  auth: ReturnType<typeof getFirebaseServices>['auth'],
): Promise<string | null> {
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
    return auth.currentUser?.uid ?? null;
  }

  return new Promise<string | null>((resolve) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user?.uid ?? null);
      },
      () => {
        unsubscribe();
        resolve(null);
      },
    );
  });
}

/**
 * Ensures the current tab is signed in with Firebase Anonymous Auth using `browserSessionPersistence`.
 */
export async function ensureAnonymousAuth(): Promise<{ uid: string }> {
  const { auth } = getFirebaseServices();
  await configureAuthSessionPersistence(auth);

  if (auth.currentUser) {
    return { uid: auth.currentUser.uid };
  }

  if (!pendingAuthPromise) {
    pendingAuthPromise = (async () => {
      try {
        const existingUid = await waitForInitialUser(auth);
        if (existingUid) {
          return { uid: existingUid };
        }
        const credential = await signInAnonymously(auth);
        return { uid: credential.user.uid };
      } finally {
        pendingAuthPromise = null;
      }
    })();
  }

  return pendingAuthPromise;
}

/**
 * Returns the currently authenticated anonymous `uid`, or `null` if not signed in yet.
 */
export function getCurrentUid(): string | null {
  if (!isFirebaseConfigured()) {
    return null;
  }
  try {
    return getFirebaseServices().auth.currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

function makeDefaultPlayerName(uid?: string | null): string {
  const activeUid = uid ?? getCurrentUid();
  if (activeUid && activeUid.length >= 4) {
    return `Agent-${activeUid.slice(0, 4).toUpperCase()}`;
  }
  return 'Agent-SHRD';
}

/**
 * Loads the player's saved display name from `sessionStorage`, falling back to `Agent-XXXX`.
 */
export function loadSavedPlayerName(fallbackUid?: string | null): string {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(PLAYER_NAME_STORAGE_KEY);
      if (raw) {
        const clean = sanitizePlayerName(raw);
        if (isValidPlayerName(clean)) {
          return clean;
        }
      }
    }
  } catch {
    // Ignore storage access errors in restricted/headless contexts
  }
  return makeDefaultPlayerName(fallbackUid);
}

/**
 * Sanitizes and persists the player's display name (1..16 chars) in `sessionStorage`.
 */
export function savePlayerName(name: string): string {
  const clean = sanitizePlayerName(name);
  if (!isValidPlayerName(clean)) {
    return loadSavedPlayerName();
  }
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(PLAYER_NAME_STORAGE_KEY, clean);
    }
  } catch {
    // Ignore storage access errors
  }
  return clean;
}
