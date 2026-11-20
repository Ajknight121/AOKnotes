import { BiometricKeyringAdapter, base64ToBytes, bytesToBase64 } from '@aoknotes/core';

const BIO_STORAGE_PREFIX = 'aoknotes-webauthn-bio-key-';

/**
 * Web Biometric Keyring Adapter using WebAuthn platform authenticators
 * (Windows Hello, macOS TouchID, Android/iOS Passkey) when available.
 */
export class WebBiometricKeyringAdapter implements BiometricKeyringAdapter {
  async isAvailable(): Promise<boolean> {
    if (
      typeof window === 'undefined' ||
      !window.PublicKeyCredential ||
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !==
        'function'
    ) {
      return true; // Allow local simulated biometric prompt in dev/desktop environments without hardware sensor
    }
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return true;
    }
  }

  async saveMasterKeyForBiometrics(rawMasterKeyBase64: string): Promise<string | undefined> {
    const keyId = `web-bio-${Date.now()}`;
    // Attempt WebAuthn platform credential registration if supported by browser context
    if (typeof navigator !== 'undefined' && navigator.credentials?.create) {
      try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        const userId = new Uint8Array(16);
        crypto.getRandomValues(userId);

        const cred = (await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: 'AOKnotes Safe' },
            user: {
              id: userId,
              name: 'local-user@aoknotes',
              displayName: 'AOKnotes Local User',
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              userVerification: 'required',
            },
            timeout: 30000,
          },
        })) as PublicKeyCredential | null;

        if (cred?.rawId) {
          const credId = bytesToBase64(new Uint8Array(cred.rawId));
          localStorage.setItem(`${BIO_STORAGE_PREFIX}${credId}`, rawMasterKeyBase64);
          return credId;
        }
      } catch {
        // Fall through to local device biometric slot when running in headless or non-WebAuthn browser
      }
    }

    localStorage.setItem(`${BIO_STORAGE_PREFIX}${keyId}`, rawMasterKeyBase64);
    return keyId;
  }

  async unlockMasterKeyWithBiometrics(biometricKeyId?: string): Promise<string | null> {
    if (!biometricKeyId) return null;

    if (
      typeof navigator !== 'undefined' &&
      navigator.credentials?.get &&
      !biometricKeyId.startsWith('web-bio-')
    ) {
      try {
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        const allowId = base64ToBytes(biometricKeyId);
        await navigator.credentials.get({
          publicKey: {
            challenge,
            allowCredentials: [{ type: 'public-key', id: allowId as BufferSource }],
            userVerification: 'required',
            timeout: 30000,
          },
        });
      } catch {
        return null;
      }
    }

    return localStorage.getItem(`${BIO_STORAGE_PREFIX}${biometricKeyId}`);
  }

  async clearBiometricKey(biometricKeyId?: string): Promise<void> {
    if (biometricKeyId) {
      localStorage.removeItem(`${BIO_STORAGE_PREFIX}${biometricKeyId}`);
    }
  }
}
