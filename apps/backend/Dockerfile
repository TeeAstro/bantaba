# Bantaba API (NestJS). Built by Render (render.yaml) or docker compose.
# Database changes are applied separately before each start:
#   npx prisma migrate deploy        (Render: preDeployCommand)
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && mkdir -p uploads mail-previews && chown node:node uploads mail-previews
# Owned by the app's user: files copied from a Mac can be readable by
# their owner only, which would stop the app from reading them.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
