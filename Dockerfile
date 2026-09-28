FROM node:20-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ .
COPY frontend/ ../frontend/

EXPOSE 5000

CMD ["node", "server.js"]
