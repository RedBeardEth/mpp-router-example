# Builds the static app with public configuration baked in, then serves it with
# the dependency-free proxy in server.mjs. Pass the same values to both stages.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG ROUTER_ORIGIN
ARG ROUTER_RECIPIENT
ARG TEMPO_NETWORK=testnet
ARG MAX_PAYMENT=0.10
RUN test -n "$ROUTER_ORIGIN" && test -n "$ROUTER_RECIPIENT" \
  && npx tsc --noEmit && npx vite build

FROM node:24-alpine
WORKDIR /app
ARG ROUTER_ORIGIN
ENV NODE_ENV=production PORT=8080 ROUTER_ORIGIN=$ROUTER_ORIGIN
COPY --from=build /app/dist ./dist
COPY server.mjs ./
USER node
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
