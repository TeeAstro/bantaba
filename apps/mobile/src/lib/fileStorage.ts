import { File, Paths } from 'expo-file-system';
import type { Storage } from './offlineScan';

// Phase 21: the offline ticket list and scan queue, in files in the app's
// own folder (safe from the system clearing it). Each key is one file.
// Too big for the keychain (storage.ts holds only the sign-in).
const fileFor = (key: string) => new File(Paths.document, `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);

export const fileStorage: Storage = {
  async get(key) {
    try {
      const f = fileFor(key);
      return f.exists ? await f.text() : null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    const f = fileFor(key);
    if (!f.exists) f.create();
    f.write(value);
  },
};
