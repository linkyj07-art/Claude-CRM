FROM node:22-slim

WORKDIR /app

# Safety net in case better-sqlite3 can't find a prebuilt binary for this
# platform and falls back to compiling from source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
