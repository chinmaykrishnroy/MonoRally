FROM node:24-alpine

ARG VERSION=dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="MonoRally" \
      org.opencontainers.image.description="Minimal high-speed multiplayer paddle game" \
      org.opencontainers.image.source="https://github.com/chinmaykrishnroy/MonoRally" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node client ./client

USER node

EXPOSE 8787

CMD ["node", "server/src/index.js"]
