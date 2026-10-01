import { UserRole } from '@prisma/client';
import { ApiEnum } from '../../common/api-enum';

// Response shapes for the auth endpoints, for the OpenAPI spec (the
// @nestjs/swagger build plugin reads these types; see docs/api.md).

export class PublicUserDto {
  id!: string;
  email!: string;
  @ApiEnum(UserRole, 'UserRole')
  role!: UserRole;
  fullName!: string | null;
}

export class AuthSessionDto {
  user!: PublicUserDto;
  /** Short-lived JWT (15 min by default). Send as `Authorization: Bearer <token>`. */
  accessToken!: string;
  /** Opaque, single-use. Exchange at POST /auth/refresh; store it in the Keychain/Keystore on mobile. */
  refreshToken!: string;
}

export class TokenPairDto {
  accessToken!: string;
  /** Replaces the refresh token you sent, which is now revoked. Reusing the old one signs the user out everywhere. */
  refreshToken!: string;
  tokenId!: string;
}

export class CurrentUserDto {
  id!: string;
  email!: string;
  @ApiEnum(UserRole, 'UserRole')
  role!: UserRole;
}

export class SuccessDto {
  success!: boolean;
}
