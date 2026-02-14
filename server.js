const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

// Get system stats
async function getStats() {
  try {
    // CPU usage
    const { stdout: cpuStdout } = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1");
    const cpuUsage = parseFloat(cpuStdout.trim()) || 0;

    // Memory
    const { stdout: memStdout } = await execAsync("free | grep Mem | awk '{print $3,$2,$7}'");
    const [used, total, available] = memStdout.trim().split(/\s+/).map(x => parseInt(x) * 1024); // Convert to bytes
    const memoryUsage = ((used / total) * 100).toFixed(1);

    // Disk
    const { stdout: diskStdout } = await execAsync("df -h / | tail -1 | awk '{print $3,$2,$5}'");
    const [diskUsed, diskTotal, diskPercent] = diskStdout.trim().split(/\s+/);

    // Docker containers
    const { stdout: dockerStdout } = await execAsync("docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}'");
    const containers = dockerStdout.trim().split('\n').filter(Boolean).map(line => {
      const [name, status, ports] = line.split('|');
      return { name, status, ports: ports || 'none' };
    });

    // Uptime
    const { stdout: uptimeStdout } = await execAsync("uptime -p");
    const uptime = uptimeStdout.trim();

    // Load average
    const { stdout: loadStdout } = await execAsync("uptime | awk -F'load average:' '{print $2}'");
    const loadAvg = loadStdout.trim();

    // Coolify health
    let coolifyHealth = 'unknown';
    try {
      const { stdout: coolifyStdout } = await execAsync("curl -s http://localhost:8000/api/health");
      coolifyHealth = coolifyStdout.trim() === 'OK' ? 'healthy' : 'unhealthy';
    } catch (e) {
      coolifyHealth = 'unreachable';
    }

    return {
      timestamp: new Date().toISOString(),
      cpu: { usage: cpuUsage, cores: require('os').cpus().length },
      memory: { used, total, available, percent: memoryUsage },
      disk: { used: diskUsed, total: diskTotal, percent: diskPercent.replace('%', '') },
      containers: { count: containers.length, list: containers },
      uptime,
      loadAvg,
      coolify: coolifyHealth,
      hostname: require('os').hostname()
    };
  } catch (error) {
    console.error('Stats error:', error);
    return { error: error.message, timestamp: new Date().toISOString() };
  }
}

// API Routes
app.get('/api/stats', async (req, res) => {
  const stats = await getStats();
  res.json(stats);
});

// Reboot container (protected by simple auth)
app.post('/api/container/:name/restart', express.json(), async (req, res) => {
  const { name } = req.params;
  const { token } = req.body;
  
  if (token !== process.env.RESTART_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await execAsync(`docker restart ${name}`);
    res.json({ success: true, message: `Container ${name} restarted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard server running on port ${PORT}`);
});
