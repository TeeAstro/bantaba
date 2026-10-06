import type { Storage } from './offlineScan';

// Phase 21, web build of the app (Expo web, for testing): localStorage.
export const fileStorage: Storage = {
  get: async (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: async (key, value) => {
    localStorage.setItem(key, value);
  },
};
