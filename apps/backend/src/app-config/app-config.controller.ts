import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { API_VERSION } from '../openapi';
import { AppConfigDto } from './app-config.dto';

const SEMVER = /^\d+\.\d+\.\d+$/;
const version = (value: string | undefined, fallback: string) =>
  value && SEMVER.test(value.trim()) ? value.trim() : fallback;

// Public, unauthenticated: the mobile apps call it at launch, before sign-in,
// to find out whether they're still supported (docs/mobile-apps.md, Step 1).
// Versions come from env vars so a forced update needs no code change:
// raise MOBILE_MIN_VERSION_IOS / _ANDROID and restart.
@Controller('app-config')
export class AppConfigController {
  @Get()
  @ApiOkResponse({ type: AppConfigDto })
  get(): AppConfigDto {
    return {
      apiVersion: API_VERSION,
      minSupportedVersion: {
        ios: version(process.env.MOBILE_MIN_VERSION_IOS, '0.0.0'),
        android: version(process.env.MOBILE_MIN_VERSION_ANDROID, '0.0.0'),
      },
      latestVersion: {
        ios: version(process.env.MOBILE_LATEST_VERSION_IOS, '0.0.0'),
        android: version(process.env.MOBILE_LATEST_VERSION_ANDROID, '0.0.0'),
      },
    };
  }
}
