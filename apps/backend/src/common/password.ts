import * as argon2 from 'argon2';
import { generateRandomToken } from './token.util';

// Password hashing (load test, Phase 22). argon2id with the settings OWASP
// recommends (19 MiB, 2 passes, 1 lane). The library's defaults (64 MiB,
// 3 passes, 4 lanes) took about 450 ms of a small server's CPU per sign-in
// and 64 MB of memory each, so a few dozen people signing in at once
// stalled everything; these take about 70 ms. Older hashes still verify,
// and are upgraded the next time that person signs in.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, OPTIONS);

export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password).catch(() => false);

/** True when a hash was made with older settings (re-hash after a correct sign-in). */
export const passwordNeedsRehash = (hash: string) => {
  try {
    return argon2.needsRehash(hash, OPTIONS);
  } catch {
    return false;
  }
};

// For accounts with no password (guest checkout, email-code sign-up, a
// password cleared for safety): the hash of a random secret that is thrown
// away, so no password ever matches. One per server process: hashing a
// new random secret for every guest cost the same CPU as a sign-in, and in
// an on-sale rush that queue held up everyone.
let unusable: Promise<string> | null = null;
export const unusablePasswordHash = () => (unusable ??= hashPassword(generateRandomToken()));
