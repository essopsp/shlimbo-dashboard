const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('./logger');

const TOKEN_EXPIRY = '24h';

function authenticateSecret(secret) {
  if (!config.dashboardSecret) {
    logger.warn('DASHBOARD_SECRET not configured — rejecting all auth attempts');
    return null;
  }
  if (secret !== config.dashboardSecret) {
    return null;
  }

  const token = jwt.sign(
    { role: 'admin', iat: Math.floor(Date.now() / 1000) },
    config.jwtSecret,
    { expiresIn: TOKEN_EXPIRY }
  );
  return token;
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    return decoded;
  } catch (e) {
    return null;
  }
}

function isAuthConfigured() {
  return !!config.dashboardSecret;
}

module.exports = { authenticateSecret, verifyToken, isAuthConfigured };
