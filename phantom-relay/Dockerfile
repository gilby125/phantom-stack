FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY tsconfig.json ./
ENV SANDBOXED_URL=http://sandboxed:3000
ENV SANDBOXED_JWT=change-me
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
