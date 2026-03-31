FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY tsconfig.json ./
ENV SANDBOXED_URL=http://sandboxed:3000
ENV SANDBOXED_JWT=change-me
ENV LIBRARY_REPO_URL=''
ENV ANTHROPIC_API_KEY=''
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
