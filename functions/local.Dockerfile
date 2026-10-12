FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY scripts/workspace-check.mjs scripts/workspace-check.d.mts ./scripts/
COPY src ./src
COPY functions ./functions
RUN npx tsc --project tsconfig.runtime.json && npm prune --omit=dev
COPY src/*.mjs ./dist/src/
COPY scripts/workspace-check.mjs ./dist/scripts/workspace-check.mjs

FROM mcr.microsoft.com/azure-functions/node:4-node22@sha256:4ba7ae108e9e4cb1e806311f1e83bf784543b99d91a2cdbc8aa72bc092153334
ENV AzureWebJobsScriptRoot=/home/site/wwwroot AzureFunctionsJobHost__Logging__Console__IsEnabled=true
WORKDIR /home/site/wwwroot
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY --from=build /app/dist/scripts ./dist/scripts
COPY --from=build /app/dist/functions ./dist/functions
COPY functions/local-package.json ./package.json
COPY functions/local-host.json ./host.json
