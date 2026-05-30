const promClient = require('prom-client');
const config = require('../config');

// Create a Registry to register metrics
const register = new promClient.Registry();

// Add default metrics (Node.js)
promClient.collectDefaultMetrics({ register });

// ── Custom Gauges ────────────────────────────────────────────────
const cpuUsageGauge = new promClient.Gauge({
  name: 'dashboard_cpu_usage_percent',
  help: 'CPU usage percentage',
  registers: [register],
});

const memoryUsageGauge = new promClient.Gauge({
  name: 'dashboard_memory_usage_percent',
  help: 'Memory usage percentage',
  registers: [register],
});

const memoryUsedGauge = new promClient.Gauge({
  name: 'dashboard_memory_used_bytes',
  help: 'Memory used in bytes',
  registers: [register],
});

const memoryTotalGauge = new promClient.Gauge({
  name: 'dashboard_memory_total_bytes',
  help: 'Total memory in bytes',
  registers: [register],
});

const diskUsageGauge = new promClient.Gauge({
  name: 'dashboard_disk_usage_percent',
  help: 'Disk usage percentage',
  registers: [register],
});

const containerCountGauge = new promClient.Gauge({
  name: 'dashboard_container_count',
  help: 'Number of running Docker containers',
  registers: [register],
});

const coolifyHealthGauge = new promClient.Gauge({
  name: 'dashboard_coolify_health',
  help: 'Coolify health status (1=healthy, 0=unhealthy)',
  registers: [register],
});

function updateMetrics(stats) {
  if (stats.cpu) cpuUsageGauge.set(stats.cpu.usage || 0);
  if (stats.memory) {
    memoryUsageGauge.set(parseFloat(stats.memory.percent) || 0);
    memoryUsedGauge.set(stats.memory.used || 0);
    memoryTotalGauge.set(stats.memory.total || 0);
  }
  if (stats.disk) diskUsageGauge.set(parseFloat(stats.disk.percent) || 0);
  if (stats.containers) containerCountGauge.set(stats.containers.count || 0);
  if (stats.coolify) coolifyHealthGauge.set(stats.coolify === 'healthy' ? 1 : 0);
}

async function getMetrics() {
  return register.metrics();
}

module.exports = { updateMetrics, getMetrics };
