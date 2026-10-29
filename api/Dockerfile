# One image, three commands: the HTTP API (default), the dispatcher worker, and the seed script.
#
# Unlike procure-flow's Express API there is a build stage. Node can strip TypeScript types,
# but Nest's dependency injection needs decorator metadata, which only a compiler emits.

FROM node:24-alpine AS build
WORKDIR /app

# mongodb-memory-server is a dev dependency for the integration tests. Without this, its
# install script downloads a MongoDB binary into a build layer that is thrown away anyway.
ENV MONGOMS_DISABLE_POSTINSTALL=1

COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json

# `npm ci` from the lockfile: reproducible, and it fails if the lockfile and manifests disagree
# rather than quietly resolving something newer. Scoped to this workspace, so the React app's
# dependencies never enter the image.
RUN npm ci --workspace @ticket-flow/api

COPY api ./api
RUN npm run build --workspace @ticket-flow/api

FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
RUN npm ci --workspace @ticket-flow/api --omit=dev

FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# api/package.json carries "type": "module", which is what makes Node load dist/*.js as ESM.
COPY api/package.json ./api/package.json
COPY --from=build /app/api/dist ./api/dist

# node:alpine ships an unprivileged `node` user. Running as root inside a container is a free
# privilege escalation if anything else goes wrong.
USER node

EXPOSE 3000

CMD ["node", "api/dist/main.js"]
