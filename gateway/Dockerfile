FROM node:22-alpine

WORKDIR /app

COPY gateway/package.json ./package.json
COPY gateway/src ./src
COPY web/public ./web

ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST=/app/web

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

CMD ["node", "src/server.js"]
