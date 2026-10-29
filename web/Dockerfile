# Build the React bundle, then serve the static output from nginx.
#
# Two stages so the runtime image contains no Node, no node_modules and no sources — only the
# compiled bundle and a web server.

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json

# Only the web workspace's dependencies: the API's (Nest, Mongoose, the test MongoDB binary)
# have no business in this build.
RUN npm ci --workspace @ticket-flow/web

COPY web ./web
RUN npm run build --workspace @ticket-flow/web

FROM nginx:1.29-alpine

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 80
