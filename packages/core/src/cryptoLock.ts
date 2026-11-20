import { Note, SafeConfig } from './types';

/**
 * Unified "Safe" Vault Encryption & Session Manager.
 *
 * Design:
 * - All locked notes are grouped together in the "Safe" (`note.lock.inSafe === true`).
 * - A single 256-bit Safe Master Key encrypts all notes in the Safe using AES-256-GCM.
 * - When the user first locks a note, if no Safe PIN exists yet, they are prompted to create a Safe PIN
 *   (and optionally enable Biometrics).
 * - Unlocking the Safe requires ONLY ONE login (via PIN or Biometrics), which unwraps the
 *   Safe Master Key into memory for the active Safe session so the user can view and edit all
 *   Safe notes seamlessly.
 * - The Settings panel can change or reset the Safe PIN at any time via `changeSafePin` or `resetSafePin`.
 */

const SAFE_VERIFICATION_PLAINTEXT = 'AOK_SAFE_VERIFIED_V1';
const PBKDF2_ITERATIONS = 100_000;

export interface BiometricKeyringAdapter {
  isAvailable(): Promise<boolean>;
  saveMasterKeyForBiometrics(rawMasterKeyBase64: string): Promise<string | undefined>;
  unlockMasterKeyWithBiometrics(biometricKeyId?: string): Promise<string | null>;
  clearBiometricKey(biometricKeyId?: string): Promise<void>;
}

function getSubtle(): SubtleCrypto {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto SubtleCrypto API is required for Safe encryption.');
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  globalThis.crypto.getRandomValues(arr);
  return arr;
}

async function derivePinKeyEncryptionKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  const encoder = new TextEncoder();
  const baseKey = await subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function importRawMasterKey(rawMasterKeyBase64: string): Promise<CryptoKey> {
  const subtle = getSubtle();
  const rawBytes = base64ToBytes(rawMasterKeyBase64);
  return subtle.importKey(
    'raw',
    rawBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportRawMasterKey(masterKey: CryptoKey): Promise<string> {
  const subtle = getSubtle();
  const raw = await subtle.exportKey('raw', masterKey);
  return bytesToBase64(new Uint8Array(raw));
}

export async function encryptStringWithMasterKey(
  plaintext: string,
  masterKey: CryptoKey
): Promise<{ cipherBase64: string; ivBase64: string }> {
  const subtle = getSubtle();
  const iv = randomBytes(12);
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    masterKey,
    encoded
  );
  return {
    cipherBase64: bytesToBase64(new Uint8Array(cipherBuf)),
    ivBase64: bytesToBase64(iv),
  };
}

export async function decryptStringWithMasterKey(
  cipherBase64: string,
  ivBase64: string,
  masterKey: CryptoKey
): Promise<string> {
  const subtle = getSubtle();
  const iv = base64ToBytes(ivBase64);
  const cipherBytes = base64ToBytes(cipherBase64);
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    masterKey,
    cipherBytes as BufferSource
  );
  return new TextDecoder().decode(plainBuf);
}

/**
 * Sets up the Safe for the first time when a user locks their first page or configures a PIN.
 * Returns both the persisted `SafeConfig` and the unlocked `CryptoKey` for the current session.
 */
export async function setupSafePin(
  newPin: string,
  options?: {
    enableBiometrics?: boolean;
    biometricAdapter?: BiometricKeyringAdapter;
  }
): Promise<{ config: SafeConfig; sessionMasterKey: CryptoKey; rawMasterKeyBase64: string }> {
  if (!newPin || newPin.trim().length < 4) {
    throw new Error('Safe PIN must be at least 4 characters.');
  }

  const subtle = getSubtle();
  const rawMasterKey = randomBytes(32);
  const rawMasterKeyBase64 = bytesToBase64(rawMasterKey);
  const sessionMasterKey = await importRawMasterKey(rawMasterKeyBase64);

  const pinSalt = randomBytes(16);
  const pinKek = await derivePinKeyEncryptionKey(newPin, pinSalt);
  const wrapIv = randomBytes(12);

  const wrappedBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: wrapIv as BufferSource },
    pinKek,
    rawMasterKey as BufferSource
  );

  const verification = await encryptStringWithMasterKey(
    SAFE_VERIFICATION_PLAINTEXT,
    sessionMasterKey
  );

  let biometricsEnabled = false;
  let biometricKeyId: string | undefined;

  if (options?.enableBiometrics && options.biometricAdapter) {
    const available = await options.biometricAdapter.isAvailable();
    if (available) {
      biometricKeyId = await options.biometricAdapter.saveMasterKeyForBiometrics(rawMasterKeyBase64);
      biometricsEnabled = true;
    }
  }

  const config: SafeConfig = {
    isConfigured: true,
    pinSalt: bytesToBase64(pinSalt),
    wrappedMasterKeyIv: bytesToBase64(wrapIv),
    wrappedMasterKey: bytesToBase64(new Uint8Array(wrappedBuf)),
    verificationCipher: verification.cipherBase64,
    verificationIv: verification.ivBase64,
    biometricsEnabled,
    biometricKeyId,
    updatedAt: Date.now(),
  };

  return { config, sessionMasterKey, rawMasterKeyBase64 };
}

/**
 * Unlocks the Safe session using the user's Safe PIN (one login unlocks all notes in the Safe).
 */
export async function unlockSafeSessionWithPin(
  pin: string,
  config: SafeConfig
): Promise<{ sessionMasterKey: CryptoKey; rawMasterKeyBase64: string }> {
  if (!config.isConfigured) {
    throw new Error('Safe PIN has not been configured yet.');
  }

  const subtle = getSubtle();
  const pinSalt = base64ToBytes(config.pinSalt);
  const wrapIv = base64ToBytes(config.wrappedMasterKeyIv);
  const wrappedBytes = base64ToBytes(config.wrappedMasterKey);

  try {
    const pinKek = await derivePinKeyEncryptionKey(pin, pinSalt);
    const rawMasterBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: wrapIv as BufferSource },
      pinKek,
      wrappedBytes as BufferSource
    );
    const rawMasterKeyBase64 = bytesToBase64(new Uint8Array(rawMasterBuf));
    const sessionMasterKey = await importRawMasterKey(rawMasterKeyBase64);

    const check = await decryptStringWithMasterKey(
      config.verificationCipher,
      config.verificationIv,
      sessionMasterKey
    );
    if (check !== SAFE_VERIFICATION_PLAINTEXT) {
      throw new Error('Safe verification failed.');
    }

    return { sessionMasterKey, rawMasterKeyBase64 };
  } catch {
    throw new Error('Incorrect Safe PIN.');
  }
}

/**
 * Unlocks the Safe session using hardware Biometrics (FaceID / TouchID / Android Biometric / WebAuthn).
 */
export async function unlockSafeSessionWithBiometrics(
  config: SafeConfig,
  biometricAdapter: BiometricKeyringAdapter
): Promise<{ sessionMasterKey: CryptoKey; rawMasterKeyBase64: string }> {
  if (!config.isConfigured || !config.biometricsEnabled) {
    throw new Error('Biometric unlock is not enabled for the Safe.');
  }

  const rawMasterKeyBase64 = await biometricAdapter.unlockMasterKeyWithBiometrics(
    config.biometricKeyId
  );
  if (!rawMasterKeyBase64) {
    throw new Error('Biometric authentication was cancelled or failed.');
  }

  const sessionMasterKey = await importRawMasterKey(rawMasterKeyBase64);
  const check = await decryptStringWithMasterKey(
    config.verificationCipher,
    config.verificationIv,
    sessionMasterKey
  );
  if (check !== SAFE_VERIFICATION_PLAINTEXT) {
    throw new Error('Biometric key verification failed.');
  }

  return { sessionMasterKey, rawMasterKeyBase64 };
}

/**
 * Changes or resets the Safe PIN from the Settings panel.
 * - When `existingSessionMasterKey` (or `currentPin`) is provided, re-wraps the SAME Safe Master Key
 *   with the new PIN so all existing Safe notes remain accessible without even needing to re-encrypt every note.
 * - When `forceNewSafeVault` is true (e.g. user forgot their PIN and chooses to reset Safe), creates a new Safe Master Key.
 */
export async function changeOrResetSafePin(
  newPin: string,
  currentConfig: SafeConfig,
  options: {
    currentPin?: string;
    unlockedSessionMasterKey?: CryptoKey;
    forceResetVault?: boolean;
    enableBiometrics?: boolean;
    biometricAdapter?: BiometricKeyringAdapter;
  }
): Promise<{ config: SafeConfig; sessionMasterKey: CryptoKey; rawMasterKeyBase64: string }> {
  if (!newPin || newPin.trim().length < 4) {
    throw new Error('New Safe PIN must be at least 4 characters.');
  }

  let sessionMasterKey: CryptoKey | undefined = options.unlockedSessionMasterKey;
  if (!sessionMasterKey && options.currentPin && currentConfig.isConfigured) {
    const unlocked = await unlockSafeSessionWithPin(options.currentPin, currentConfig);
    sessionMasterKey = unlocked.sessionMasterKey;
  }

  if (!sessionMasterKey) {
    if (options.forceResetVault || !currentConfig.isConfigured) {
      return setupSafePin(newPin, {
        enableBiometrics: options.enableBiometrics ?? currentConfig.biometricsEnabled,
        biometricAdapter: options.biometricAdapter,
      });
    }
    throw new Error('Current PIN or unlocked Safe session is required to change PIN.');
  }

  const subtle = getSubtle();
  const rawMasterKeyBase64 = await exportRawMasterKey(sessionMasterKey);
  const rawMasterKeyBytes = base64ToBytes(rawMasterKeyBase64);

  const newPinSalt = randomBytes(16);
  const newPinKek = await derivePinKeyEncryptionKey(newPin, newPinSalt);
  const newWrapIv = randomBytes(12);

  const wrappedBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv: newWrapIv as BufferSource },
    newPinKek,
    rawMasterKeyBytes as BufferSource
  );

  const updatedConfig: SafeConfig = {
    ...currentConfig,
    isConfigured: true,
    pinSalt: bytesToBase64(newPinSalt),
    wrappedMasterKeyIv: bytesToBase64(newWrapIv),
    wrappedMasterKey: bytesToBase64(new Uint8Array(wrappedBuf)),
    biometricsEnabled: options.enableBiometrics ?? currentConfig.biometricsEnabled,
    updatedAt: Date.now(),
  };

  return { config: updatedConfig, sessionMasterKey, rawMasterKeyBase64 };
}

/**
 * Moves a note into the Safe and encrypts its content at rest with the Safe Master Key.
 */
export async function moveNoteToSafe(
  note: Note,
  sessionMasterKey: CryptoKey
): Promise<Note> {
  if (note.lock.inSafe && note.lock.isEncryptedAtRest) {
    return note;
  }

  const encryptedBody = await encryptStringWithMasterKey(note.content, sessionMasterKey);
  return {
    ...note,
    content: encryptedBody.cipherBase64,
    preview: '🔒 Protected in Safe',
    updatedAt: Date.now(),
    lock: {
      inSafe: true,
      isEncryptedAtRest: true,
      iv: encryptedBody.ivBase64,
    },
  };
}

/**
 * Decrypts a Safe note in memory for viewing/editing once the Safe session is unlocked.
 * Does NOT remove the note from the Safe.
 */
export async function decryptSafeNoteForSession(
  note: Note,
  sessionMasterKey: CryptoKey
): Promise<Note> {
  if (!note.lock.isEncryptedAtRest || !note.lock.iv) {
    return note;
  }

  const plainContent = await decryptStringWithMasterKey(
    note.content,
    note.lock.iv,
    sessionMasterKey
  );

  return {
    ...note,
    content: plainContent,
    preview: plainContent.slice(0, 140),
    lock: {
      ...note.lock,
      inSafe: true,
      isEncryptedAtRest: false,
    },
  };
}

/**
 * Re-encrypts an edited Safe note for at-rest storage while keeping it inside the Safe.
 */
export async function encryptSafeNoteForStorage(
  decryptedSafeNote: Note,
  sessionMasterKey: CryptoKey
): Promise<Note> {
  const encryptedBody = await encryptStringWithMasterKey(
    decryptedSafeNote.content,
    sessionMasterKey
  );
  return {
    ...decryptedSafeNote,
    content: encryptedBody.cipherBase64,
    preview: '🔒 Protected in Safe',
    lock: {
      inSafe: true,
      isEncryptedAtRest: true,
      iv: encryptedBody.ivBase64,
    },
  };
}

/**
 * Removes a note from the Safe back to the regular main notes board (decrypted).
 */
export async function removeNoteFromSafe(
  note: Note,
  sessionMasterKey: CryptoKey
): Promise<Note> {
  const decrypted = note.lock.isEncryptedAtRest
    ? await decryptSafeNoteForSession(note, sessionMasterKey)
    : note;

  return {
    ...decrypted,
    preview: decrypted.content.slice(0, 140),
    updatedAt: Date.now(),
    lock: {
      inSafe: false,
      isEncryptedAtRest: false,
      iv: undefined,
    },
  };
}
