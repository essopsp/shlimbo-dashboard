FROM node:20-alpine

WORKDIR /app

# Install docker group and add node user
RUN apk add --no-cache shadow && \
    addgroup -g 999 docker 2>/dev/null || true && \
    addgroup node docker 2>/dev/null || true

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public ./public

EXPOSE 3000

# Run as root to access docker.sock (needed for Coolify deployment)
USER root

CMD ["node", "server.js"]
