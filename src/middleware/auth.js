const authService = require('../services/auth');

const PUBLIC_PATHS = new Set([
  '/health',
  '/login',
  '/api/auth',        // POST login
  '/api/auth/status', // GET auth config status (no token needed to check)
]);

function authMiddleware(req, res, next) {
  // Skip auth for public paths
  if (PUBLIC_PATHS.has(req.path)) {
    return next();
  }

  // Skip auth for the login page and static files
  if (req.path === '/' || req.path.startsWith('/ws')) {
    return next();
  }

  // Skip auth for static files
  if (req.path.startsWith('/ws')) {
    return next();
  }

  // If auth is not configured, allow access
  if (!authService.isAuthConfigured()) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid token' });
  }

  const token = authHeader.slice(7);
  const decoded = authService.verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Token expired or invalid' });
  }

  req.user = decoded;
  next();
}

module.exports = authMiddleware;
