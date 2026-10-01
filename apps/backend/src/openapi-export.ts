import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApiDocument, configureApp } from './openapi';

// Writes the OpenAPI spec to apps/backend/openapi.json without starting
// the server or touching the database: `preview` mode builds the module
// graph (all the route metadata the spec needs) but never instantiates
// providers, so Prisma never connects. Run with `npm run openapi`; commit
// the result whenever the API changes, since the mobile apps generate
// their API clients from it (docs/api.md, docs/mobile-apps.md).
async function main() {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  configureApp(app);
  const doc = buildOpenApiDocument(app);
  const out = join(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${Object.keys(doc.paths).length} paths to ${out}`);
  await app.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
