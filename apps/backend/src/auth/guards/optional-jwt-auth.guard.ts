import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Used on routes that are public but behave differently for an
// authenticated owner/admin (e.g. event detail: an unpublished event is
// visible to its organizer, invisible to everyone else). Unlike
// JwtAuthGuard, this never throws for a missing/invalid token — it just
// leaves `request.user` null so the route handler can treat the caller
// as anonymous.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(
    _err: unknown,
    user: unknown,
    _info: unknown,
    _context: ExecutionContext,
    _status?: unknown,
  ): TUser {
    return (user ?? null) as TUser;
  }
}