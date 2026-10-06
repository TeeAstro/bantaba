import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string; // userId
  role: UserRole;
  // When it was made, in milliseconds (security review, Phase 21b): `iat` is in
  // whole seconds, too coarse to tell a sign-in from a sign-out a moment later.
  at?: number;
}
