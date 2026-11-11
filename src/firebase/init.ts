import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
} from 'firebase/auth';
import { connectDatabaseEmulator, type Database, getDatabase } from 'firebase/database';

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
}

let cachedServices: FirebaseServices | null = null;
let emulatorsConnected = false;
let persistencePromise: Promise<void> | null = null;

function readFirebaseEnvConfig(): { options: FirebaseOptions; useEmulator: boolean } {
  const env = import.meta.env ?? {};
  const options: FirebaseOptions = {
    apiKey: env.VITE_FIREBASE_API_KEY?.trim() || undefined,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || undefined,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL?.trim() || undefined,
    projectId: env.VITE_FIREBASE_PROJECT_ID?.trim() || undefined,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || undefined,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || undefined,
    appId: env.VITE_FIREBASE_APP_ID?.trim() || undefined,
  };
  const useEmulator = env.VITE_USE_FIREBASE_EMULATOR === 'true';
  return { options, useEmulator };
}

/**
 * Returns `true` when the required VITE_FIREBASE_* environment variables are present.
 */
export function isFirebaseConfigured(): boolean {
  const { options } = readFirebaseEnvConfig();
  return Boolean(options.apiKey && options.projectId && options.databaseURL);
}

/**
 * Lazily initializes and returns the singleton modular Firebase App, Auth, and Realtime Database instances.
 * Connects to local Auth (9099) & Database (9000) emulators strictly when `VITE_USE_FIREBASE_EMULATOR === 'true'`.
 */
export function getFirebaseServices(): FirebaseServices {
  if (cachedServices) {
    return cachedServices;
  }

  const { options, useEmulator } = readFirebaseEnvConfig();
  if (!options.apiKey || !options.projectId || !options.databaseURL) {
    throw new Error(
      'Firebase ist nicht konfiguriert (fehlende VITE_FIREBASE_* Umgebungsvariablen).',
    );
  }

  const existingApps = getApps();
  const app = existingApps.length > 0 ? existingApps[0] : initializeApp(options);
  const auth = getAuth(app);
  const db = getDatabase(app, options.databaseURL);

  if (useEmulator && !emulatorsConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(db, '127.0.0.1', 9000);
    emulatorsConnected = true;
  }

  cachedServices = { app, auth, db };
  return cachedServices;
}

/**
 * Configures per-tab `browserSessionPersistence` (`sessionStorage`) in browsers so:
 * 1. Reloading (`F5`) keeps the same anonymous `uid` within that tab.
 * 2. Opening a second browser tab gets a distinct anonymous `uid` for effortless 1-PC multi-tab lobby testing.
 * Falls back to `inMemoryPersistence` in non-browser (Node/Vitest) environments.
 */
export async function configureAuthSessionPersistence(auth: Auth): Promise<void> {
  if (!persistencePromise) {
    const persistence =
      typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
        ? browserSessionPersistence
        : inMemoryPersistence;
    persistencePromise = setPersistence(auth, persistence).catch((err) => {
      persistencePromise = null;
      throw err;
    });
  }
  await persistencePromise;
}
