import {
  BackupTargetConfig,
  Note,
  SafeConfig,
  createNewNote,
} from '@aoknotes/core';

const DB_NAME = 'aoknotes-local-db';
const DB_VERSION = 1;
const NOTES_STORE = 'notes';
const META_STORE = 'meta';
const EMERGENCY_FLUSH_KEY = 'aoknotes-exit-flush-notes';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const DEFAULT_SAFE_CONFIG: SafeConfig = {
  isConfigured: false,
  pinSalt: '',
  wrappedMasterKeyIv: '',
  wrappedMasterKey: '',
  verificationCipher: '',
  verificationIv: '',
  biometricsEnabled: false,
  updatedAt: 0,
};

export const DEFAULT_BACKUP_TARGETS: BackupTargetConfig[] = [
  {
    id: 'pc-local-default',
    type: 'pc-local',
    displayName: 'Personal PC (Local Wi-Fi / LAN)',
    enabled: true,
    autoSyncWhenAvailable: true,
    endpointUrl: 'http://localhost:4545',
    encryptBeforeUpload: false,
  },
  {
    id: 'user-cloud-default',
    type: 'user-cloud-webdav',
    displayName: 'My Cloud Storage (WebDAV / S3 / Google Drive)',
    enabled: false,
    autoSyncWhenAvailable: false,
    endpointUrl: 'local-cloud-sim://user-own-cloud',
    bucketOrFolder: '/AOKnotes-Vault',
    encryptBeforeUpload: true,
  },
  {
    id: 'self-hosted-default',
    type: 'self-hosted-rest',
    displayName: 'Self-Hostable Backend (REST / Supabase)',
    enabled: false,
    autoSyncWhenAvailable: false,
    endpointUrl: 'local-cloud-sim://self-hosted',
    bucketOrFolder: 'notes_vault',
    encryptBeforeUpload: true,
  },
];

export function createSeedNotes(): Note[] {
  const now = Date.now();
  return [
    createNewNote({
      id: 'seed-welcome',
      title: 'Welcome to AOKnotes (Local-First)',
      content: [
        '# Local-First & Private by Design',
        '- [x] All notes live locally on your device first (IndexedDB on Web, SQLite on Phone)',
        '- [x] Unlimited character limit with 60fps virtualized block scrolling',
        '- [x] Leaving or closing the app immediately flushes & saves your work',
        '- [ ] Try locking a note to send it to your encrypted **Safe** (one login unlocks all Safe notes)',
        '- [ ] Try **Snooze Delete** to temporarily delete a note and have it automatically return!',
      ].join('\n'),
      color: '#fef3c7',
      pinned: true,
      tags: ['getting-started', 'local-first'],
      now: now - 120_000,
    }),
    createNewNote({
      id: 'seed-architecture',
      title: 'Personal PC Sync & Space-Saving History',
      content: [
        '## Backup & Sync Options',
        '1. **Personal PC Sync**: Automatically syncs over your local network while your PC is on, or run a one-time manual snapshot backup.',
        '2. **Share with Desktop**: Send any note directly as a `.md`, `.txt`, or `.aok.json` file to your PC.',
        '3. **Pluggable Cloud**: Connect your own cloud storage (WebDAV/S3/Drive) or a self-hosted backend.',
      ].join('\n'),
      color: '#dcfce7',
      pinned: false,
      tags: ['backup', 'sync'],
      now: now - 60_000,
    }),
  ];
}

export async function loadAllLocalNotes(): Promise<Note[]> {
  // Check if an emergency exit-flush occurred during page unload
  try {
    const emergencyJson = localStorage.getItem(EMERGENCY_FLUSH_KEY);
    if (emergencyJson) {
      localStorage.removeItem(EMERGENCY_FLUSH_KEY);
      const parsed = JSON.parse(emergencyJson) as Note[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        await saveAllLocalNotes(parsed);
        return parsed;
      }
    }
  } catch {
    // ignore localStorage read issues
  }

  try {
    const db = await openDatabase();
    const notes = await new Promise<Note[]>((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const store = tx.objectStore(NOTES_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as Note[]) ?? []);
      req.onerror = () => reject(req.error);
    });

    if (notes.length === 0) {
      const seeded = await loadMetaValue<boolean>('seeded');
      if (!seeded) {
        const initial = createSeedNotes();
        await saveAllLocalNotes(initial);
        await saveMetaValue('seeded', true);
        return initial;
      }
    }
    return notes.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  } catch {
    return createSeedNotes();
  }
}

export async function saveAllLocalNotes(notes: Note[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    const store = tx.objectStore(NOTES_STORE);
    store.clear();
    for (const note of notes) {
      store.put(note);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Synchronous + asynchronous exit save used when the user leaves the app, hides the tab,
 * or closes the browser window (`visibilitychange`, `pagehide`, `beforeunload`).
 */
export function flushNotesOnAppExit(notes: Note[]): void {
  try {
    localStorage.setItem(EMERGENCY_FLUSH_KEY, JSON.stringify(notes));
  } catch {
    // fallback if quota exceeded
  }
  void saveAllLocalNotes(notes).then(() => {
    try {
      localStorage.removeItem(EMERGENCY_FLUSH_KEY);
    } catch {
      // ignore
    }
  });
}

export async function loadMetaValue<T>(key: string): Promise<T | null> {
  try {
    const db = await openDatabase();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const store = tx.objectStore(META_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const res = req.result as { key: string; value: T } | undefined;
        resolve(res ? res.value : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveMetaValue<T>(key: string, value: T): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    store.put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
