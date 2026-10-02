import * as SecureStore from 'expo-secure-store';
import type { SecureStorage } from '../api/client';

// Keychain (iOS) / Keystore (Android). Tokens stay on this device only and
// are readable while the phone is unlocked — enough for a scanner that runs
// in the foreground, and never synced to iCloud backups.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStorage: SecureStorage = {
  get: (key) => SecureStore.getItemAsync(key, options),
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  delete: (key) => SecureStore.deleteItemAsync(key, options),
};
