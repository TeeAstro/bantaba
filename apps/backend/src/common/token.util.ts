import { randomBytes, createHash } from 'crypto';

// Used anywhere a random secret needs to be handed to the client once and
// verified later without the server ever storing the raw value — refresh
// tokens and password reset tokens (Phase 3), and from Phase 5, the
// secure credential embedded in a ticket's QR code.
export function generateRandomToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(rawToken: string): string {
  // A fast hash is appropriate here, not argon2 — these tokens are
  // already high-entropy random values, so there's no low-entropy input
  // to protect against brute force the way there is with a password.
  return createHash('sha256').update(rawToken).digest('hex');
}
