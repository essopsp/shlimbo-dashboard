const express = require('express');
const cors = require('cors');
const Docker = require('dockerode');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to Docker via socket
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.use(cors());
app.use(express.static('public'));

// Format bytes helper
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Get CPU usage
async function getCpuUsage() {
    return new Promise((resolve) => {
        const startIdle = os.cpus().reduce((acc, cpu) => acc + cpu.times.idle, 0);
        const startTotal = os.cpus().reduce((acc, cpu) => 
            acc + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);
        
        setTimeout(() => {
            const endIdle = os.cpus().reduce((acc, cpu) => acc + cpu.times.idle, 0);
            const endTotal = os.cpus().reduce((acc, cpu) => 
                acc + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);
            
            const idleDiff = endIdle - startIdle;
            const totalDiff = endTotal - startTotal;
            const usage = 100 - Math.round((idleDiff / totalDiff) * 100);
            
            resolve(usage < 0 ? 0 : usage);
        }, 1000);
    });
}

// Get system stats
async function getStats() {
    try {
        // CPU usage (quick estimate)
        const cpuUsage = await getCpuUsage().catch(() => {
            // Fallback: calculate from loadavg
            const [oneMin] = os.loadavg();
            return Math.min(Math.round((oneMin / os.cpus().length) * 100), 100);
        });

        // Memory
        const memTotal = os.totalmem();
        const memFree = os.freemem();
        const memUsed = memTotal - memFree;
        const memoryPercent = ((memUsed / memTotal) * 100).toFixed(1);

        // Disk (from shell - works in container)
        let diskUsed = '0G', diskTotal = '0G', diskPercent = '0';
        try {
            const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $3,$2,$5}'");
            const parts = stdout.trim().split(/\s+/);
            if (parts.length >= 3) {
                [diskUsed, diskTotal, diskPercent] = parts;
            }
        } catch (e) {
            console.log('Disk check failed:', e.message);
        }

        // Docker containers via API
        let containers = [];
        let containerCount = 0;
        try {
            const containerList = await docker.listContainers({ all: true });
            containerCount = containerList.filter(c => c.State === 'running').length;
            containers = containerList.filter(c => c.State === 'running').map(c => ({
                name: c.Names[0].replace(/^\//, ''),
                status: c.Status,
                ports: c.Ports.length > 0 
                    ? c.Ports.map(p => `${p.PublicPort || p.PrivatePort}:${p.PrivatePort}`).slice(0, 2).join(', ') + (c.Ports.length > 2 ? '...' : '')
                    : 'no ports'
            }));
        } catch (e) {
            console.log('Docker API error:', e.message);
        }

        // Uptime
        const uptime = require('child_process').execSync('uptime -p', { encoding: 'utf-8' }).trim();

        // Load average
        const [oneMinLoad] = os.loadavg();
        const loadAvg = oneMinLoad.toFixed(2);

        // Coolify health
        let coolifyHealth = 'unknown';
        try {
            const { stdout } = await execAsync("curl -s http://coolify:8000/api/health || curl -s http://localhost:8000/api/health");
            coolifyHealth = stdout.trim() === 'OK' ? 'healthy' : 'unhealthy';
        } catch (e) {
            coolifyHealth = 'unreachable';
        }

        return {
            timestamp: new Date().toISOString(),
            cpu: { 
                usage: cpuUsage, 
                cores: os.cpus().length 
            },
            memory: { 
                used: memUsed, 
                total: memTotal, 
                available: memFree, 
                percent: memoryPercent 
            },
            disk: { 
                used: diskUsed, 
                total: diskTotal, 
                percent: diskPercent.replace('%', '') 
            },
            containers: { 
                count: containerCount, 
                list: containers 
            },
            uptime,
            loadAvg,
            coolify: coolifyHealth,
            hostname: os.hostname()
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
        const container = docker.getContainer(name);
        await container.restart();
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
