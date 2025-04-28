###########################################################################
# Build base image
###########################################################################
FROM node:22-alpine AS base

COPY ./ /var/workdir/

WORKDIR /var/workdir/

ENV PNPM_VERSION=10.7.1
ENV PNPM_HOME=/usr/local/bin
RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$(mktemp)" SHELL="$(which sh)" sh -s --

RUN pnpm install --frozen-lockfile

###########################################################################
# Build bundle image
###########################################################################
FROM base AS bundle

RUN pnpm esbuild index.mjs --bundle --outdir=dist --platform=node

###########################################################################
# Build runtime image
###########################################################################
FROM node:22-alpine

# COPY --from=base /var/workdir/.env /var/workdir/
COPY --from=bundle /var/workdir/dist/ /var/workdir/

RUN echo ${TEST} > test

WORKDIR /var/workdir/

ENTRYPOINT node index.js
