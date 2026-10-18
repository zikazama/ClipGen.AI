FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev
COPY server server
COPY --from=build /app/dist dist
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
