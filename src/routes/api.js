const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const statsService = require('../services/stats');
const dockerService = require('../services/docker');
const authService = require('../services/auth');
const historyService = require('../services/history');
const config = require('../config');
const logger = require('../services/logger');

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  message: { error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: 30,
  message: { error: 'Too many requests, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

const restartLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3,
  message: { error: 'Too many restart requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Auth (with strict rate limiting) ─────────────────────────────
router.post('/auth', authLimiter, express.json(), (req, res) => {
  const { secret } = req.body;
  if (!secret) {
    return res.status(400).json({ error: 'Secret key is required' });
  }

  const token = authService.authenticateSecret(secret);
  if (!token) {
    logger.warn('Failed login attempt');
    return res.status(401).json({ error: 'Invalid secret key' });
  }

  logger.info('Successful login');
  res.json({ token, expiresIn: '24h' });
});

// ── Stats (with API rate limiting) ───────────────────────────────
router.get('/stats', apiLimiter, async (req, res) => {
  try {
    const stats = await statsService.getStats();

    // Run Docker and Coolify operations in parallel with individual timeouts
    // Overall timeout: 6s — if slower, we return stats without Docker data
    const externalData = await Promise.race([
      Promise.all([
        dockerService.listContainers().catch(() => ({ count: 0, list: [] })),
        dockerService.getContainerResources().catch(() => []),
        checkCoolifyHealth(),
      ]),
      new Promise((resolve) => setTimeout(() => {
        resolve([{ count: 0, list: [] }, [], 'unknown']);
      }, 4000)),
    ]);

    const [containers, containerResources, coolifyHealth] = externalData;
    stats.containers = containers;
    stats.containerResources = containerResources;
    stats.coolify = coolifyHealth;

    // Save to history (fire-and-forget)
    historyService.insertSample(stats);

    res.json(stats);
  } catch (error) {
    logger.error({ err: error }, 'Stats route error');
    res.status(500).json({ error: error.message, timestamp: new Date().toISOString() });
  }
});

// ── History ──────────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const range = req.query.range || '1h';
  if (!['1h', '6h', '24h'].includes(range)) {
    return res.status(400).json({ error: 'Invalid range. Use 1h, 6h, or 24h.' });
  }
  const data = historyService.getHistory(range);
  res.json({ range, count: data.length, data });
});

// Helper: Coolify health check (with timeout)
async function checkCoolifyHealth() {
  const { exec } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(exec);

  try {
    const result = await Promise.race([
      execAsync("curl -s --max-time 3 http://coolify:8080/api/health 2>/dev/null || echo 'FAILED'"),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Coolify health check timed out')), 4000)),
    ]);
    const stdout = Array.isArray(result) ? result[0] : result.stdout;
    const trimmed = stdout?.trim();
    if (trimmed === 'OK' || trimmed === 'healthy') return 'healthy';
    if (trimmed === 'FAILED') return 'unhealthy';
    return 'unhealthy';
  } catch (e) {
    return 'unreachable';
  }
}

// ── Container Restart (with strict rate limiting) ───────────────
router.post('/container/:name/restart', restartLimiter, express.json(), async (req, res) => {
  const { name } = req.params;
  const { token } = req.body;

  if (!config.restartToken) {
    return res.status(501).json({ error: 'RESTART_TOKEN not configured' });
  }
  if (token !== config.restartToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await dockerService.restartContainer(name);
    logger.info({ container: name }, 'Container restarted');
    res.json({ success: true, message: `Container ${name} restarted` });
  } catch (error) {
    logger.error({ err: error, container: name }, 'Container restart failed');
    res.status(500).json({ error: error.message });
  }
});

// ── Auth Status ──────────────────────────────────────────────────
router.get('/auth/status', (req, res) => {
  res.json({
    configured: authService.isAuthConfigured(),
    authenticated: !!req.user,
  });
});

// ── Check Auth Token ─────────────────────────────────────────────
router.get('/auth/check', (req, res) => {
  // If we get here, auth middleware already validated the token
  res.json({ valid: true, user: req.user });
});

module.exports = router;
