# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/schema/package.json packages/schema/
COPY packages/query/package.json packages/query/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @amplio/api... --filter @amplio/query...

COPY packages/schema packages/schema
COPY packages/query packages/query
COPY apps/api apps/api
RUN pnpm --filter @amplio/schema build \
  && pnpm --filter @amplio/query build \
  && pnpm --filter @amplio/api build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 8788
CMD ["node", "apps/api/dist/index.js"]
