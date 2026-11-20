export type NoteStatus = 'active' | 'archived' | 'trashed' | 'snooze_deleted';

export type VersionBucket = 'recent' | 'daily' | 'weekly';

export interface LinePatchOp {
  type: 'keep' | 'insert' | 'delete';
  /** Start line index in the target document */
  lineIndex: number;
  /** Lines removed from the newer version (to reconstruct the older version) */
  deletedCount?: number;
  /** Lines restored into the older version */
  lines?: string[];
}

export interface NoteVersionDelta {
  id: string;
  timestamp: number;
  summary: string;
  /** Compact JSON-serialized LinePatchOp[] transforming the next version back to this version */
  patch: string;
  byteSize: number;
  charCountAtVersion: number;
  bucket: VersionBucket;
}

export interface NoteLockMetadata {
  /** Whether the note is stored inside the unified "Safe" vault */
  inSafe: boolean;
  /** Whether the content field currently holds AES-256-GCM ciphertext */
  isEncryptedAtRest: boolean;
  /** AES-GCM initialization vector (base64) for this note's content */
  iv?: string;
  /** AES-GCM initialization vector (base64) for encrypted title in Safe */
  titleIv?: string;
}

/**
 * Global Safe Configuration stored per device/vault.
 * All locked notes live together in the "Safe" and share a single Safe Master Key
 * wrapped by the user's Safe PIN (and optionally hardware biometrics).
 */
export interface SafeConfig {
  isConfigured: boolean;
  /** Base64 PBKDF2 salt used to derive the PIN key-encryption-key (KEK) */
  pinSalt: string;
  /** Base64 IV used when wrapping the Safe Master Key with the PIN KEK */
  wrappedMasterKeyIv: string;
  /** Base64 AES-256-GCM wrapped Safe Master Key */
  wrappedMasterKey: string;
  /** Verification token encrypted with the Safe Master Key ("AOK_SAFE_OK") */
  verificationCipher: string;
  verificationIv: string;
  /** Whether biometric unlock (FaceID / TouchID / WebAuthn) is enabled for the Safe */
  biometricsEnabled: boolean;
  /** Optional credential or biometric key identifier */
  biometricKeyId?: string;
  updatedAt: number;
}

export interface Note {
  id: string;
  title: string;
  /** Plain text / Markdown when unlocked; AES-256-GCM base64 ciphertext when encrypted in Safe */
  content: string;
  /** Fast card preview snippet (redacted when note is in Safe) */
  preview: string;
  color: string;
  pinned: boolean;
  tags: string[];
  status: NoteStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  /** Timestamp (ms) when a snooze-deleted note automatically returns to 'active' */
  snoozeUntil?: number;
  /** Optional flag indicating the note was recently restored from Snooze Delete */
  restoredFromSnoozeAt?: number;
  /** Hybrid Logical Clock timestamp for deterministic PC & Cloud delta sync */
  hlcTimestamp: string;
  deviceId: string;
  lock: NoteLockMetadata;
  versions: NoteVersionDelta[];
}

export type BackupTargetType =
  | 'pc-local'
  | 'user-cloud-webdav'
  | 'user-cloud-s3'
  | 'user-cloud-gdrive'
  | 'self-hosted-rest';

export interface BackupTargetConfig {
  id: string;
  type: BackupTargetType;
  displayName: string;
  enabled: boolean;
  autoSyncWhenAvailable: boolean;
  endpointUrl: string;
  pairingTokenOrApiKey?: string;
  bucketOrFolder?: string;
  encryptBeforeUpload: boolean;
  lastSyncedAt?: number;
  lastSyncCursor?: string;
}

export interface BackupSyncResult {
  targetId: string;
  syncedAt: number;
  pushedCount: number;
  pulledCount: number;
  mode: 'auto' | 'manual-onetime' | 'desktop-share';
  snapshotPath?: string;
}

export interface BackupProvider {
  readonly id: string;
  readonly type: BackupTargetType;
  readonly displayName: string;
  testConnection(): Promise<{ online: boolean; details?: string }>;
  syncDelta(
    localNotes: Note[],
    lastSyncCursor?: string
  ): Promise<{
    mergedNotes: Note[];
    newCursor: string;
    result: BackupSyncResult;
  }>;
  manualOneTimeBackup(localNotes: Note[]): Promise<BackupSyncResult>;
  shareNoteToDesktop?(
    note: Note,
    format: 'md' | 'txt' | 'json'
  ): Promise<{ savedPath: string; fileName: string }>;
}
