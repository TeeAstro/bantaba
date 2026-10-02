import type { SecureStorage } from '../api/client';

// Web preview only (`npx expo start --web`), for checking layouts in a
// desktop browser. Phones always use storage.ts (Keychain/Keystore) —
// Metro picks this file only for web builds. The web is not a supported
// target for this app; staff on a browser use the web scanner at /scan.
export const secureStorage: SecureStorage = {
  get: async (key) => sessionStorage.getItem(key),
  set: async (key, value) => sessionStorage.setItem(key, value),
  delete: async (key) => sessionStorage.removeItem(key),
};
