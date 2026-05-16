FROM node:24-alpine

ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node client ./client

USER node

EXPOSE 8787

CMD ["node", "server/src/index.js"]
