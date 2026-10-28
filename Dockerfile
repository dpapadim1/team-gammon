# Stage 1: production dependencies. better-sqlite3 is compiled here when no prebuilt binary fits Alpine.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: the runtime image only carries what server/index.js imports, plus the published network.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY engine ./engine
COPY bots ./bots
COPY models ./models
COPY server ./server
COPY client ./client

# The SQLite database lives in a mounted volume.
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
