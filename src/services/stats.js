const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const logger = require('./logger');
const config = require('../config');

// ── CPU Background Sampling ──────────────────────────────────────
let cachedCpuUsage = 0;

function sampleCpu() {
  const cpus = os.cpus();
  const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
  const totalTick = cpus.reduce((acc, cpu) => acc + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);

  setTimeout(() => {
    const cpusEnd = os.cpus();
    const endIdle = cpusEnd.reduce((acc, cpu) => acc + cpu.times.idle, 0);
    const endTick = cpusEnd.reduce((acc, cpu) => acc + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);

    const idleDiff = endIdle - totalIdle;
    const tickDiff = endTick - totalTick;
    const usage = tickDiff > 0 ? 100 - Math.round((idleDiff / tickDiff) * 100) : 0;
    cachedCpuUsage = usage < 0 ? 0 : usage;

    // Schedule next sample
    sampleCpu();
  }, config.sampleInterval);
}

// Start background CPU sampling
sampleCpu();

function getCpuUsage() {
  return cachedCpuUsage;
}

// ── Helpers ──────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ── Network I/O ──────────────────────────────────────────────────
let previousNetStats = null;
let cachedNetStats = { interfaces: [], rxBytes: 0, txBytes: 0 };

function sampleNetwork() {
  try {
    const data = require('fs').readFileSync('/proc/net/dev', 'utf8');
    const lines = data.split('\n').slice(2); // skip headers
    const interfaces = [];
    let totalRx = 0;
    let totalTx = 0;

    for (const line of lines) {
      const match = line.match(/^\s*(eth\d+|ens\d+|enp\S+):\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
      if (match) {
        const rx = parseInt(match[2], 10);
        const tx = parseInt(match[10], 10);
        interfaces.push({ name: match[1], rx, tx });
        totalRx += rx;
        totalTx += tx;
      }
    }

    if (previousNetStats) {
      const delta = (config.sampleInterval) / 1000; // seconds
      cachedNetStats = {
        interfaces: interfaces.map((iface, i) => {
          const prev = previousNetStats.interfaces[i];
          return {
            name: iface.name,
            rxPerSec: prev ? Math.round((iface.rx - prev.rx) / delta) : 0,
            txPerSec: prev ? Math.round((iface.tx - prev.tx) / delta) : 0,
          };
        }),
        rxBytes: totalRx,
        txBytes: totalTx,
        rxPerSec: Math.round((totalRx - previousNetStats.rxBytes) / delta),
        txPerSec: Math.round((totalTx - previousNetStats.txBytes) / delta),
      };
    } else {
      cachedNetStats = {
        interfaces: interfaces.map(i => ({ name: i.name, rxPerSec: 0, txPerSec: 0 })),
        rxBytes: totalRx,
        txBytes: totalTx,
        rxPerSec: 0,
        txPerSec: 0,
      };
    }

    previousNetStats = { interfaces, rxBytes: totalRx, txBytes: totalTx };
  } catch (e) {
    // /proc/net/dev not available
  }
}

// Sample network on every CPU sample tick (tied to sample interval)
// We'll call this from the stats collection instead

// ── Stats Collection ─────────────────────────────────────────────
async function getStats() {
  try {
    const cpuUsage = getCpuUsage();

    // Memory
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;
    const memoryPercent = ((memUsed / memTotal) * 100).toFixed(1);

    // Disk
    let diskUsed = '0G', diskTotal = '0G', diskPercent = '0';
    try {
      const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $3,$2,$5}'");
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 3) {
        [diskUsed, diskTotal, diskPercent] = parts;
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'Disk check failed');
    }

    // Network
    sampleNetwork();

    // Uptime
    const uptimeSeconds = os.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptime = `up ${days} days, ${hours} hours, ${minutes} minutes`;

    const [oneMinLoad] = os.loadavg();

    return {
      timestamp: new Date().toISOString(),
      cpu: {
        usage: cpuUsage,
        cores: os.cpus().length,
      },
      memory: {
        used: memUsed,
        total: memTotal,
        available: memFree,
        percent: memoryPercent,
      },
      disk: {
        used: diskUsed,
        total: diskTotal,
        percent: diskPercent.replace('%', ''),
      },
      network: cachedNetStats,
      uptime,
      loadAvg: oneMinLoad.toFixed(2),
      hostname: os.hostname(),
    };
  } catch (error) {
    logger.error({ err: error }, 'Stats collection error');
    return { error: error.message, timestamp: new Date().toISOString() };
  }
}

module.exports = { getStats, getCpuUsage, formatBytes };
