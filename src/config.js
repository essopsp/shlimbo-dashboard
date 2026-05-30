const path = require('path');

// Load .env in development only
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch (e) {
    // dotenv not available or no .env file
  }
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'production',

  // Auth
  dashboardSecret: process.env.DASHBOARD_SECRET || '',
  restartToken: process.env.RESTART_TOKEN || '',

  // JWT: use DASHBOARD_SECRET as JWT secret, with fallback
  jwtSecret: process.env.JWT_SECRET || process.env.DASHBOARD_SECRET || '',

  // Alert thresholds (percentage)
  alertThresholds: {
    cpu: parseInt(process.env.ALERT_CPU, 10) || 80,
    memory: parseInt(process.env.ALERT_MEMORY, 10) || 80,
    disk: parseInt(process.env.ALERT_DISK, 10) || 85,
  },

  // Refresh / sample interval (ms)
  sampleInterval: parseInt(process.env.SAMPLE_INTERVAL, 10) || 2000,

  // WebSocket
  wsPath: '/ws',
};

// Validation (warn only — auth endpoints will reject if unconfigured)
if (!config.dashboardSecret && config.nodeEnv === 'production') {
  console.warn('WARNING: DASHBOARD_SECRET not set — authentication is disabled');
}

module.exports = config;
