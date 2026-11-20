import {
  BackupProvider,
  BackupSyncResult,
  BackupTargetConfig,
  BackupTargetType,
  Note,
} from './types';
import { exportNoteToFileArtifact } from './exportEngine';

/**
 * Generates or advances a Hybrid Logical Clock (HLC) string (`<wallTimeMs>-<counter>-<deviceId>`)
 * for deterministic conflict-free sync across Phone, Web, and Personal PC.
 */
export function advanceHlcTimestamp(
  deviceId: string,
  previousHlc?: string,
  now = Date.now()
): string {
  const paddedNow = String(now).padStart(15, '0');
  if (!previousHlc) {
    return `${paddedNow}-0000-${deviceId}`;
  }
  const parts = previousHlc.split('-');
  const prevTime = parts[0] ?? '';
  const prevCounter = parseInt(parts[1] ?? '0', 10) || 0;

  if (paddedNow > prevTime) {
    return `${paddedNow}-0000-${deviceId}`;
  }
  const nextCounter = String(prevCounter + 1).padStart(4, '0');
  return `${prevTime}-${nextCounter}-${deviceId}`;
}

/**
 * Merges two sets of notes (e.g., device local notes + PC or Cloud notes) using HLC / updatedAt ordering.
 */
export function mergeNotesByHlc(
  localNotes: Note[],
  remoteNotes: Note[]
): {
  mergedNotes: Note[];
  pushedCount: number;
  pulledCount: number;
} {
  const localMap = new Map<string, Note>();
  for (const n of localNotes) {
    localMap.set(n.id, n);
  }

  const remoteMap = new Map<string, Note>();
  for (const r of remoteNotes) {
    remoteMap.set(r.id, r);
  }

  const allIds = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  const mergedNotes: Note[] = [];
  let pushedCount = 0;
  let pulledCount = 0;

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (local && !remote) {
      mergedNotes.push(local);
      pushedCount++;
    } else if (!local && remote) {
      mergedNotes.push(remote);
      pulledCount++;
    } else if (local && remote) {
      const localKey = local.hlcTimestamp || String(local.updatedAt).padStart(15, '0');
      const remoteKey = remote.hlcTimestamp || String(remote.updatedAt).padStart(15, '0');
      if (localKey > remoteKey) {
        mergedNotes.push(local);
        pushedCount++;
      } else if (remoteKey > localKey) {
        mergedNotes.push(remote);
        pulledCount++;
      } else {
        mergedNotes.push(local);
      }
    }
  }

  mergedNotes.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return { mergedNotes, pushedCount, pulledCount };
}

/**
 * 1. Personal PC Local Sync & Backup Provider.
 * - Automatically syncs while the Personal PC daemon is running on the local network.
 * - Supports manual one-time snapshot backups and sharing individual notes directly to the PC desktop.
 */
export class PersonalPcSyncProvider implements BackupProvider {
  readonly id: string;
  readonly type: BackupTargetType = 'pc-local';
  readonly displayName: string;
  private readonly endpointUrl: string;
  private readonly pairingToken?: string;

  constructor(config: BackupTargetConfig) {
    this.id = config.id;
    this.displayName = config.displayName || 'Personal PC (Local Wi-Fi / LAN)';
    this.endpointUrl = config.endpointUrl.replace(/\/+$/, '');
    this.pairingToken = config.pairingTokenOrApiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.pairingToken) {
      h['X-AOK-Pairing-Token'] = this.pairingToken;
    }
    return h;
  }

  async testConnection(): Promise<{ online: boolean; details?: string }> {
    try {
      const res = await fetch(`${this.endpointUrl}/api/status`, {
        method: 'GET',
        headers: this.headers(),
      });
      if (!res.ok) {
        return { online: false, details: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { hostname?: string; vaultPath?: string };
      return {
        online: true,
        details: `Connected to ${data.hostname || 'Personal PC'} (${data.vaultPath || 'Local Vault'})`,
      };
    } catch (err) {
      return {
        online: false,
        details: err instanceof Error ? err.message : 'PC daemon unreachable',
      };
    }
  }

  async syncDelta(
    localNotes: Note[],
    lastSyncCursor?: string
  ): Promise<{
    mergedNotes: Note[];
    newCursor: string;
    result: BackupSyncResult;
  }> {
    const res = await fetch(`${this.endpointUrl}/api/sync`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        notes: localNotes,
        cursor: lastSyncCursor,
      }),
    });

    if (!res.ok) {
      throw new Error(`PC Sync failed with HTTP ${res.status}`);
    }

    const payload = (await res.json()) as {
      mergedNotes: Note[];
      cursor: string;
      pushedCount: number;
      pulledCount: number;
      syncedAt: number;
    };

    return {
      mergedNotes: payload.mergedNotes,
      newCursor: payload.cursor,
      result: {
        targetId: this.id,
        syncedAt: payload.syncedAt,
        pushedCount: payload.pushedCount,
        pulledCount: payload.pulledCount,
        mode: 'auto',
      },
    };
  }

  async manualOneTimeBackup(localNotes: Note[]): Promise<BackupSyncResult> {
    const res = await fetch(`${this.endpointUrl}/api/backup/snapshot`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        notes: localNotes,
        requestedAt: Date.now(),
      }),
    });

    if (!res.ok) {
      throw new Error(`PC One-Time Backup failed with HTTP ${res.status}`);
    }

    const payload = (await res.json()) as {
      syncedAt: number;
      snapshotPath: string;
      noteCount: number;
    };

    return {
      targetId: this.id,
      syncedAt: payload.syncedAt,
      pushedCount: payload.noteCount,
      pulledCount: 0,
      mode: 'manual-onetime',
      snapshotPath: payload.snapshotPath,
    };
  }

  async shareNoteToDesktop(
    note: Note,
    format: 'md' | 'txt' | 'json'
  ): Promise<{ savedPath: string; fileName: string }> {
    const artifact = exportNoteToFileArtifact(note, format);
    const res = await fetch(`${this.endpointUrl}/api/share-to-desktop`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        fileName: artifact.fileName,
        content: artifact.content,
        noteId: note.id,
        title: note.title,
      }),
    });

    if (!res.ok) {
      throw new Error(`Share to Desktop failed with HTTP ${res.status}`);
    }

    return (await res.json()) as { savedPath: string; fileName: string };
  }
}

/**
 * 2. Pluggable Cloud Provider supporting both:
 *    - User's Own Cloud Storage (WebDAV / Nextcloud / S3-compatible / Google Drive AppData)
 *    - Self-Hostable Backend (REST / Supabase / PocketBase compatible)
 */
export class PluggableCloudBackupProvider implements BackupProvider {
  readonly id: string;
  readonly type: BackupTargetType;
  readonly displayName: string;
  private readonly config: BackupTargetConfig;
  private inMemoryCloudVault: Note[] = [];

  constructor(config: BackupTargetConfig) {
    this.id = config.id;
    this.type = config.type;
    this.displayName = config.displayName;
    this.config = config;
  }

  async testConnection(): Promise<{ online: boolean; details?: string }> {
    if (!this.config.endpointUrl) {
      return { online: false, details: 'No endpoint URL configured' };
    }
    if (this.config.endpointUrl.startsWith('local-cloud-sim://')) {
      return {
        online: true,
        details: `Ready (${this.displayName} — E2EE: ${
          this.config.encryptBeforeUpload ? 'Enabled' : 'Standard'
        })`,
      };
    }
    try {
      const res = await fetch(this.config.endpointUrl, {
        method: this.type === 'user-cloud-webdav' ? 'PROPFIND' : 'GET',
        headers: this.config.pairingTokenOrApiKey
          ? { Authorization: `Bearer ${this.config.pairingTokenOrApiKey}` }
          : undefined,
      });
      return {
        online: res.ok || res.status === 207,
        details: `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        online: false,
        details: err instanceof Error ? err.message : 'Cloud endpoint unreachable',
      };
    }
  }

  async syncDelta(
    localNotes: Note[],
    lastSyncCursor?: string
  ): Promise<{
    mergedNotes: Note[];
    newCursor: string;
    result: BackupSyncResult;
  }> {
    const now = Date.now();

    if (this.config.endpointUrl.startsWith('local-cloud-sim://')) {
      const { mergedNotes, pushedCount, pulledCount } = mergeNotesByHlc(
        localNotes,
        this.inMemoryCloudVault
      );
      this.inMemoryCloudVault = mergedNotes.map((n) => ({ ...n }));
      return {
        mergedNotes,
        newCursor: `cloud-cursor-${now}`,
        result: {
          targetId: this.id,
          syncedAt: now,
          pushedCount,
          pulledCount,
          mode: 'auto',
        },
      };
    }

    // Standard REST / WebDAV / S3 JSON vault sync
    const res = await fetch(`${this.config.endpointUrl.replace(/\/+$/, '')}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.pairingTokenOrApiKey
          ? { Authorization: `Bearer ${this.config.pairingTokenOrApiKey}` }
          : {}),
      },
      body: JSON.stringify({
        notes: localNotes,
        cursor: lastSyncCursor,
        bucketOrFolder: this.config.bucketOrFolder,
      }),
    });

    if (!res.ok) {
      throw new Error(`Cloud sync failed with HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      mergedNotes: Note[];
      cursor?: string;
      pushedCount?: number;
      pulledCount?: number;
    };

    return {
      mergedNotes: data.mergedNotes,
      newCursor: data.cursor ?? `cloud-cursor-${now}`,
      result: {
        targetId: this.id,
        syncedAt: now,
        pushedCount: data.pushedCount ?? localNotes.length,
        pulledCount: data.pulledCount ?? 0,
        mode: 'auto',
      },
    };
  }

  async manualOneTimeBackup(localNotes: Note[]): Promise<BackupSyncResult> {
    const synced = await this.syncDelta(localNotes);
    return {
      ...synced.result,
      mode: 'manual-onetime',
      snapshotPath: `${this.config.bucketOrFolder || '/AOKnotes-Backups'}/snapshot-${new Date(
        synced.result.syncedAt
      )
        .toISOString()
        .replace(/[:.]/g, '-')}.aok.json`,
    };
  }
}

export function createBackupProvider(config: BackupTargetConfig): BackupProvider {
  if (config.type === 'pc-local') {
    return new PersonalPcSyncProvider(config);
  }
  return new PluggableCloudBackupProvider(config);
}
