FROM ghcr.io/home-assistant/base:latest

# Node.js om de bot te draaien
RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app/src ./src

LABEL io.hass.type="addon" \
      io.hass.name="Padelbot"

CMD ["node", "/app/src/index.js"]
