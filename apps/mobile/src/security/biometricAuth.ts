import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { BiometricKeyringAdapter } from '@aoknotes/core';

const SECURE_STORE_MASTER_KEY_SLOT = 'aoknotes_safe_master_key_v1';

/**
 * Phone Biometric Keyring Adapter using `expo-local-authentication`
 * (FaceID, TouchID, Android BiometricPrompt) + `expo-secure-store` on iOS/Android,
 * with a browser storage fallback when previewing the mobile app on `?platform=web`.
 */
export class PhoneBiometricKeyringAdapter implements BiometricKeyringAdapter {
  async isAvailable(): Promise<boolean> {
    if (Platform.OS === 'web') {
      return true;
    }
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      return hasHardware && isEnrolled;
    } catch {
      return false;
    }
  }

  async saveMasterKeyForBiometrics(rawMasterKeyBase64: string): Promise<string | undefined> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SECURE_STORE_MASTER_KEY_SLOT, rawMasterKeyBase64);
      }
      return SECURE_STORE_MASTER_KEY_SLOT;
    }

    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm phone biometrics to enable 1-tap Safe unlock',
      fallbackLabel: 'Use Safe PIN',
    });

    if (!authResult.success) {
      throw new Error('Biometric confirmation cancelled.');
    }

    await SecureStore.setItemAsync(SECURE_STORE_MASTER_KEY_SLOT, rawMasterKeyBase64, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return SECURE_STORE_MASTER_KEY_SLOT;
  }

  async unlockMasterKeyWithBiometrics(biometricKeyId?: string): Promise<string | null> {
    const slot = biometricKeyId || SECURE_STORE_MASTER_KEY_SLOT;

    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(slot);
      }
      return null;
    }

    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock AOKnotes Safe',
      fallbackLabel: 'Enter Safe PIN',
    });

    if (!authResult.success) {
      return null;
    }

    return SecureStore.getItemAsync(slot);
  }

  async clearBiometricKey(biometricKeyId?: string): Promise<void> {
    const slot = biometricKeyId || SECURE_STORE_MASTER_KEY_SLOT;
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(slot);
      }
      return;
    }
    await SecureStore.deleteItemAsync(slot);
  }
}
