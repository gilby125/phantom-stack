FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/
COPY tsconfig.json ./

ENV QDRANT_URL=http://qdrant:6333
ENV OLLAMA_URL=http://ollama:11434

CMD ["./node_modules/.bin/tsx", "src/index.ts"]
