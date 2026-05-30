const Docker = require('dockerode');
const fs = require('fs');
const logger = require('./logger');

const DOCKER_SOCKET = '/var/run/docker.sock';
const DOCKER_TIMEOUT = 2000; // 2s timeout for Docker API calls

let docker = null;
let dockerAvailable = false;

// Check if socket exists before creating client
if (fs.existsSync(DOCKER_SOCKET)) {
  try {
    docker = new Docker({ socketPath: DOCKER_SOCKET });
    logger.info('Docker client created');
  } catch (e) {
    logger.warn({ err: e.message }, 'Docker client creation failed');
    docker = null;
  }
} else {
  logger.warn('Docker socket not found at ' + DOCKER_SOCKET);
}

// Async check: ping the daemon with timeout
async function checkDockerAvailability() {
  if (!docker) return false;
  try {
    await withTimeout(docker.ping());
    dockerAvailable = true;
    logger.info('Docker daemon is reachable');
    return true;
  } catch (e) {
    dockerAvailable = false;
    logger.warn({ err: e.message }, 'Docker daemon not reachable');
    return false;
  }
}

// Run the check immediately (non-blocking)
checkDockerAvailability();

// Utility: wrap a promise with timeout
function withTimeout(promise, ms = DOCKER_TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Docker operation timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function listContainers(all = true) {
  if (!docker || !dockerAvailable) return { count: 0, list: [] };
  try {
    const containerList = await withTimeout(docker.listContainers({ all }));
    const running = containerList.filter(c => c.State === 'running');
    return {
      count: running.length,
      list: running.map(c => ({
        id: c.Id.substring(0, 12),
        name: c.Names[0].replace(/^\//, ''),
        status: c.Status,
        ports: c.Ports.length > 0
          ? c.Ports.map(p => `${p.PublicPort || p.PrivatePort}:${p.PrivatePort}`).slice(0, 2).join(', ') + (c.Ports.length > 2 ? '...' : '')
          : 'no ports',
      })),
    };
  } catch (e) {
    logger.warn({ err: e.message }, 'Docker list error');
    return { count: 0, list: [] };
  }
}

async function getContainerResources() {
  if (!docker || !dockerAvailable) return [];
  try {
    const containers = await withTimeout(docker.listContainers({ all: false }), 3000);

    // Limit to at most 10 containers for resource checking to avoid long stalls
    // Limit to at most 5 containers for resource checking
    const limited = containers.slice(0, 5);
    const resources = [];

    for (const c of limited) {
      try {
        const container = docker.getContainer(c.Id);
        const stats = await withTimeout(container.stats({ stream: false }), 400);

        // CPU calculation
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuPercent = systemDelta > 0
          ? ((cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100).toFixed(1)
          : '0.0';

        // Memory
        const memUsage = stats.memory_stats.usage || 0;
        const memLimit = stats.memory_stats.limit || 1;
        const memPercent = ((memUsage / memLimit) * 100).toFixed(1);

        resources.push({
          id: c.Id.substring(0, 12),
          name: c.Names[0].replace(/^\//, ''),
          cpu: { usage: parseFloat(cpuPercent) },
          memory: {
            usage: memUsage,
            limit: memLimit,
            percent: parseFloat(memPercent),
          },
        });
      } catch (e) {
        // Skip containers that fail stats collection
      }
    }

    return resources;
  } catch (e) {
    logger.warn({ err: e.message }, 'Container resources error');
    return [];
  }
}

async function restartContainer(name) {
  if (!docker && !dockerAvailable) throw new Error('Docker not available');
  const container = docker.getContainer(name);
  await withTimeout(container.restart());
}

module.exports = { listContainers, getContainerResources, restartContainer };
