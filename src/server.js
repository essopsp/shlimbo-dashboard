const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');
const path = require('path');

const config = require('./config');
const logger = require('./services/logger');
const authMiddleware = require('./middleware/auth');
const apiRoutes = require('./routes/api');
const statsService = require('./services/stats');
const metricsService = require('./services/metrics');

// ── Express App ──────────────────────────────────────────────────
const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      imgSrc: ["'self'", 'data:', 'https://via.placeholder.com'],
    },
  },
}));

// Request logging
const pinoHttp = require('pino-http')({ logger });
app.use(pinoHttp);

// Prometheus metrics (public, no auth)
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(await metricsService.getMetrics());
  } catch (e) {
    res.status(500).send('Error collecting metrics');
  }
});

// Auth middleware (skip public paths)
app.use(authMiddleware);

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes mounted under /api
// Rate limiters are applied per-route inside apiRoutes (see routes/api.js)
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve index.html for root
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

// ── HTTP Server ──────────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket ────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: config.wsPath });

wss.on('connection', (ws, req) => {
  logger.info('WebSocket client connected');

  // Expect first message to be authentication: { token: "..." }
  let authenticated = false;
  let authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.close(4001, 'Authentication timeout');
    }
  }, 10000);

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (!authenticated) {
        // First message must be auth
        if (msg.type === 'auth') {
          const authService = require('./services/auth');
          const decoded = authService.verifyToken(msg.token);
          if (decoded) {
            authenticated = true;
            clearTimeout(authTimeout);
            ws.send(JSON.stringify({ type: 'auth_ok' }));
          } else {
            ws.close(4001, 'Invalid token');
          }
        } else {
          ws.close(4001, 'Authenticate first');
        }
        return;
      }
    } catch (e) {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    logger.info('WebSocket client disconnected');
  });

  ws.on('error', () => {
    clearTimeout(authTimeout);
  });
});

// Broadcast stats to all connected clients every 2 seconds
setInterval(async () => {
  if (wss.clients.size === 0) return;

  try {
    const containers = await require('./services/docker').listContainers();
    const stats = await statsService.getStats();
    stats.containers = containers;

    // Update Prometheus metrics
    metricsService.updateMetrics(stats);

    // Save to history
    const historyService = require('./services/history');
    historyService.insertSample(stats);

    const payload = JSON.stringify({ type: 'stats', data: stats });

    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(payload);
      }
    });
  } catch (e) {
    logger.error({ err: e }, 'WebSocket broadcast error');
  }
}, config.sampleInterval);

// ── Start ────────────────────────────────────────────────────────
server.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'Dashboard server started');
  if (!config.dashboardSecret) {
    logger.warn('DASHBOARD_SECRET not set — authentication is disabled');
  }
});

module.exports = { app, server };
