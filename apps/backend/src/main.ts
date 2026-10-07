import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiDocument, configureApp } from './openapi';
import { rateLimitStore } from './common/rate-limit';

// Security review (Phase 21b): a production server refuses to start with
// settings that would be unsafe or quietly broken.
function checkProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  const secret = process.env.JWT_ACCESS_SECRET ?? '';
  if (secret.length < 32 || /dev-only|change-me|example/i.test(secret)) problems.push('JWT_ACCESS_SECRET must be a long random value (32+ characters), not the example one');
  if (!process.env.FRONTEND_URL?.startsWith('https://')) problems.push('FRONTEND_URL must be the https:// address of the web app');
  if (process.env.MAIL_TRANSPORT === 'log' || !process.env.SMTP_HOST) problems.push('SMTP_HOST is needed (and MAIL_TRANSPORT not "log"), or no email (tickets, sign-in codes, password resets) is delivered');
  if (process.env.ALLOW_MOCK_PAYMENTS === 'true') problems.push('ALLOW_MOCK_PAYMENTS must not be set: it gives tickets without payment');
  if (process.env.RATE_LIMITS === 'off') problems.push('RATE_LIMITS=off is for tests only');
  const key = process.env.MODEMPAY_SECRET_KEY ?? '';
  const hook = process.env.MODEMPAY_WEBHOOK_SECRET ?? '';
  const testKeys = /^sk_test_/.test(key) || /fake|test/i.test(hook);
  if (!key || !hook) problems.push('MODEMPAY_SECRET_KEY and MODEMPAY_WEBHOOK_SECRET must be set');
  else if (testKeys && process.env.MODEMPAY_TEST_MODE !== 'true') problems.push('MODEMPAY_SECRET_KEY and MODEMPAY_WEBHOOK_SECRET must be the live Modem Pay keys (before launch: set MODEMPAY_TEST_MODE=true to run with test keys)');
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`Not starting: unsafe production settings:\n - ${problems.join('\n - ')}\nSee docs/security.md.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  if (testKeys) console.warn('WARNING: Modem Pay TEST keys (MODEMPAY_TEST_MODE=true): card payments take no real money. Switch to the live keys before launch (docs/deploy.md).');
  // eslint-disable-next-line no-console
  if (!process.env.REDIS_URL) console.warn('Note: no REDIS_URL, so limits are kept in this server only. Fine for one server; set it before running more (docs/deploy.md).');
}

async function bootstrap() {
  checkProductionConfig();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  rateLimitStore(); // connect to Redis now (when REDIS_URL is set), not on the first sign-in

  // Interactive API docs (Swagger UI) at /api/docs, plus the raw spec at
  // /api/docs-json — development only. The same spec is exported to
  // apps/backend/openapi.json by `npm run openapi` (docs/api.md).
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app), {
      useGlobalPrefix: false,
      jsonDocumentUrl: 'api/docs-json',
    });
  }

  // On a deploy or restart the host sends SIGTERM: finish requests in
  // flight, close the database, then exit.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}/api/v1`);
}

bootstrap();
