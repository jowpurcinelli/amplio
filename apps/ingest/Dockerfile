# Build context is the repo root: docker build -f apps/ingest/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

# Install with the full workspace manifest set so the lockfile resolves.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/schema/package.json packages/schema/
COPY apps/ingest/package.json apps/ingest/
RUN pnpm install --frozen-lockfile --filter @amplio/ingest... --filter @amplio/schema...

COPY packages/schema packages/schema
COPY apps/ingest apps/ingest
RUN pnpm --filter @amplio/schema build && pnpm --filter @amplio/ingest build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8787
CMD ["node", "apps/ingest/dist/index.js"]
