ARG DOCKER_GID=999

FROM node:20-alpine

ARG DOCKER_GID

WORKDIR /app

# Install tools, create docker group with matching GID, add node user to it
RUN apk add --no-cache shadow curl && \
    addgroup -g ${DOCKER_GID} docker 2>/dev/null || true && \
    addgroup node docker 2>/dev/null || true

COPY package.json package-lock.json ./
RUN npm install --production --ignore-scripts

COPY src ./src
COPY public ./public
COPY .env.example ./

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run as non-root user (member of docker group for socket access)
USER node

CMD ["node", "src/server.js"]
