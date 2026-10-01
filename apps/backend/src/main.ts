import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiDocument, configureApp } from './openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);

  // Interactive API docs (Swagger UI) at /api/docs, plus the raw spec at
  // /api/docs-json — development only. The same spec is exported to
  // apps/backend/openapi.json by `npm run openapi` (docs/api.md).
  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app), {
      useGlobalPrefix: false,
      jsonDocumentUrl: 'api/docs-json',
    });
  }

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}/api/v1`);
}

bootstrap();
