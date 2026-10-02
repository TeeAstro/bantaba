import { INestApplication, ValidationPipe, VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './auth/guards/optional-jwt-auth.guard';
import { ROLES_KEY } from './auth/decorators/roles.decorator';
import { serverTimingEnabled, serverTimingMiddleware } from './common/server-timing';
import { static as serveStatic } from 'express';
import { LOCAL_MEDIA_ROUTE, localMediaDir, storageDriver } from './storage/storage.service';

export const API_VERSION = '1';

// Everything about how the app is exposed over HTTP lives here, shared by
// main.ts and the OpenAPI export script, so the exported spec always
// describes exactly the routes the server serves.
export function configureApp(app: INestApplication) {
  // Server-Timing header on every response (see common/server-timing.ts).
  if (serverTimingEnabled()) app.use(serverTimingMiddleware);
  // Uploaded images, when they're kept on this server's disk
  // (STORAGE_DRIVER=local, the default — docs/storage.md). File names are
  // random and never reused, so they can be cached forever. With S3/R2 the
  // bucket or its CDN serves them instead.
  if (storageDriver() === 'local') {
    app.use(
      LOCAL_MEDIA_ROUTE,
      serveStatic(localMediaDir(), {
        index: false,
        dotfiles: 'deny',
        immutable: true,
        maxAge: '365d',
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
      }),
    );
  }
  app.setGlobalPrefix('api');
  // URI versioning (docs/api.md): every route is served at /api/v1/...
  // VERSION_NEUTRAL also keeps the original unversioned /api/... paths
  // working as an alias of v1, so existing clients, the README's curl
  // commands and any payment webhook URL already registered with a
  // provider don't break. The alias is to be removed before launch
  // (Phase 21); new clients (the web app, the mobile apps) use /api/v1.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: [API_VERSION, VERSION_NEUTRAL] });
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['Server-Timing'], // let the web app read it too
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not defined on the DTO
      forbidNonWhitelisted: true, // reject requests that include unknown fields
      transform: true, // turn plain JSON into DTO class instances
    }),
  );
}

const controllerTag = (name: string) =>
  name.replace(/Controller$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');

// Builds the OpenAPI document for /api/v1.
//
// Request bodies, params and query strings come from the DTOs (the
// @nestjs/swagger CLI plugin reads their class-validator rules at build
// time — see nest-cli.json). Auth requirements, roles and tags are read
// straight off each controller's existing @UseGuards/@Roles metadata, so
// they can never drift from what the server actually enforces and no
// controller needs extra decorators.
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Bantaba API')
    .setDescription(
      'REST API shared by the web app and the organizer/staff mobile apps. ' +
        'Amounts are integer minor units (butut, GMD). Sign in with POST /api/v1/auth/login, ' +
        'then send the access token as `Authorization: Bearer <token>`. See docs/api.md.',
    )
    .setVersion(API_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();

  const doc = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  // The neutral alias makes every route appear twice (/api/x and
  // /api/v1/x). Publish only the versioned paths.
  const prefix = `/api/v${API_VERSION}/`;
  for (const path of Object.keys(doc.paths)) {
    if (!path.startsWith(prefix)) delete doc.paths[path];
  }

  // operationId -> auth info, from controller metadata.
  const meta = new Map<string, { tag: string; auth: 'required' | 'optional' | null; roles: string[] | null }>();
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...a: unknown[]) => unknown) | undefined;
      if (!cls || !Reflect.hasMetadata(PATH_METADATA, cls)) continue;
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
      const classRoles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, cls);
      for (const methodKey of Object.getOwnPropertyNames(cls.prototype)) {
        const handler = cls.prototype[methodKey];
        if (methodKey === 'constructor' || typeof handler !== 'function') continue;
        const guards = [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? [])];
        const roles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, handler) ?? classRoles;
        meta.set(`${cls.name.replace(/Controller$/, '')}_${methodKey}`, {
          tag: controllerTag(cls.name),
          auth: guards.includes(JwtAuthGuard) ? 'required' : guards.includes(OptionalJwtAuthGuard) ? 'optional' : null,
          roles: roles?.length ? roles : null,
        });
      }
    }
  }

  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item) as Array<Record<string, any>>) {
      if (!op || typeof op !== 'object' || !op.operationId) continue;
      const m = meta.get(op.operationId);
      if (!m) continue;
      op.tags = op.tags?.length ? op.tags : [m.tag];
      if (m.auth === 'required') {
        op.security = [{ bearer: [] }];
        op.responses['401'] ??= { description: 'Missing or expired access token' };
      } else if (m.auth === 'optional') {
        // Works signed out; a token unlocks more (e.g. an owner seeing a draft).
        op.security = [{}, { bearer: [] }];
      }
      if (m.roles) {
        op.description = [op.description, `**Roles:** ${m.roles.join(', ')}`].filter(Boolean).join('\n\n');
        op.responses['403'] ??= { description: 'Signed in, but this role (or account) may not do this' };
      }
    }
  }

  return doc;
}
