const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'metrics.db');
const MAX_RETENTION_MS = 48 * 60 * 60 * 1000; // 48 hours

let db;

try {
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Create table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      cpu_usage REAL,
      memory_percent REAL,
      disk_percent REAL,
      container_count INTEGER
    )
  `);

  // Index on timestamp for fast range queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp)
  `);

  logger.info('Metrics database initialized');
} catch (e) {
  logger.warn({ err: e.message }, 'Failed to initialize metrics database');
  db = null;
}

function insertSample(stats) {
  if (!db) return;

  try {
    const stmt = db.prepare(`
      INSERT INTO metrics (timestamp, cpu_usage, memory_percent, disk_percent, container_count)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      stats.timestamp || new Date().toISOString(),
      stats.cpu?.usage ?? null,
      stats.memory ? parseFloat(stats.memory.percent) : null,
      stats.disk ? parseFloat(stats.disk.percent) : null,
      stats.containers?.count ?? null
    );

    // Clean up old data
    const cleanupStmt = db.prepare('DELETE FROM metrics WHERE timestamp < ?');
    const cutoff = new Date(Date.now() - MAX_RETENTION_MS).toISOString();
    cleanupStmt.run(cutoff);
  } catch (e) {
    logger.warn({ err: e.message }, 'Failed to insert metric sample');
  }
}

function getHistory(range = '1h') {
  if (!db) return [];

  // Calculate the start time based on range
  const rangeMs = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  }[range] || 60 * 60 * 1000;

  const startTime = new Date(Date.now() - rangeMs).toISOString();

  try {
    const rows = db.prepare(`
      SELECT timestamp, cpu_usage, memory_percent, disk_percent, container_count
      FROM metrics
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `).all(startTime);

    return rows;
  } catch (e) {
    logger.warn({ err: e.message }, 'Failed to query history');
    return [];
  }
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { insertSample, getHistory, close };
