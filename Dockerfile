FROM node:22-slim

# ffmpeg is a system binary, not an npm package — needed for video conversion
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
ENV WORK_DIR=/tmp/asset-converter
EXPOSE 8080

CMD ["node", "server.js"]