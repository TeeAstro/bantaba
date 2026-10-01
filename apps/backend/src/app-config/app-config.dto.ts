export class PlatformVersionsDto {
  ios!: string;
  android!: string;
}

export class AppConfigDto {
  /** API version this server speaks; the apps call /api/v{apiVersion}/... */
  apiVersion!: string;
  /** Oldest app version still allowed. An app below this should block and ask the user to update. */
  minSupportedVersion!: PlatformVersionsDto;
  /** Newest released version. An app below this (but above the minimum) may suggest updating. */
  latestVersion!: PlatformVersionsDto;
}
