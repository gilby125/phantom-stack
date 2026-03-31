FROM node:20-bookworm-slim
ARG CACHE_BREAKER=2024-03-31-01

WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
ENV npm_config_build_from_source=sqlite3
RUN npm ci --omit=dev && npm rebuild sqlite3 --build-from-source
COPY src/ ./src/
COPY tsconfig.json ./
ENV SANDBOXED_URL=http://sandboxed
ENV SANDBOXED_JWT=change-me
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
