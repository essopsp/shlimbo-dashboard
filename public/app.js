// ── Auth Helper ──────────────────────────────────────────────────
const Auth = {
  getToken() {
    return sessionStorage.getItem('dashboard_token');
  },

  setToken(token) {
    sessionStorage.setItem('dashboard_token', token);
  },

  clearToken() {
    sessionStorage.removeItem('dashboard_token');
  },

  isAuthenticated() {
    return !!this.getToken();
  },

  authHeaders() {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  async checkAuth() {
    // First check if auth is configured
    try {
      const statusRes = await fetch('/api/auth/status');
      const status = await statusRes.json();
      if (!status.configured) {
        // Auth not configured — allow access without token
        return true;
      }
    } catch {
      // If we can't reach the server, redirect to login
      return false;
    }

    // Auth is configured — check if we have a valid token
    if (!this.isAuthenticated()) {
      return false;
    }

    try {
      const res = await fetch('/api/auth/check', {
        headers: { ...this.authHeaders(), Accept: 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  logout() {
    this.clearToken();
    window.location.href = '/login';
  },
};

// ── Dashboard ────────────────────────────────────────────────────
class Dashboard {
  constructor() {
    this.refreshInterval = 2000;
    this.retryDelay = 5000;
    this.maxRetries = 3;
    this.retries = 0;
    this.intervalId = null;
    this.isAutoRefreshEnabled = true;
    this.containerData = [];
    this.containerResources = [];
    this.ws = null;
    this.wsReconnectTimer = null;
    this.history = { cpu: [], memory: [] };
    this.maxHistoryPoints = 20;
    this.matrixGlyphs = '01アカサタナハマヤラワ0123456789ABCDEF';
    this.elements = this.cacheElements();
    this.init();
  }

  cacheElements() {
    return {
      // Connection
      connectionStatus: document.getElementById('connectionStatus'),
      lastUpdate: document.getElementById('lastUpdate'),
      refreshInfo: document.getElementById('refreshInfo'),

      // CPU
      cpuValue: document.getElementById('cpuValue'),
      cpuBar: document.getElementById('cpuBar'),
      cpuSpark: document.getElementById('cpuSpark'),
      cpuTrendLabel: document.getElementById('cpuTrendLabel'),
      cpuChart: document.getElementById('cpuChart'),
      cpuChartReadout: document.getElementById('cpuChartReadout'),

      // Memory
      memValue: document.getElementById('memValue'),
      memDetail: document.getElementById('memDetail'),
      memBar: document.getElementById('memBar'),
      memSpark: document.getElementById('memSpark'),
      memTrendLabel: document.getElementById('memTrendLabel'),
      memChart: document.getElementById('memChart'),
      memChartReadout: document.getElementById('memChartReadout'),

      // Disk
      diskValue: document.getElementById('diskValue'),
      diskDetail: document.getElementById('diskDetail'),
      diskBar: document.getElementById('diskBar'),

      // Network
      netRxValue: document.getElementById('netRxValue'),
      netTxDetail: document.getElementById('netTxDetail'),
      netRxBar: document.getElementById('netRxBar'),
      netTxBar: document.getElementById('netTxBar'),

      // Containers
      containerValue: document.getElementById('containerValue'),
      containerStatus: document.getElementById('containerStatus'),
      containerCount: document.getElementById('containerCount'),
      containerSearch: document.getElementById('containerSearch'),
      containerSort: document.getElementById('containerSort'),
      containersList: document.getElementById('containersList'),

      // Container resources
      containerResourcesSection: document.getElementById('containerResourcesSection'),
      containerResourcesList: document.getElementById('containerResourcesList'),
      containerResCount: document.getElementById('containerResCount'),

      // Services
      coolifyStatus: document.getElementById('coolifyStatus'),
      hostname: document.getElementById('hostname'),
      uptime: document.getElementById('uptime'),
      loadavg: document.getElementById('loadavg'),

      // Controls
      toggleRefresh: document.getElementById('toggleRefresh'),
      refreshNow: document.getElementById('refreshNow'),
      logoutBtn: document.getElementById('logoutBtn'),

      // Matrix
      matrixCanvas: document.getElementById('matrixCanvas'),
      matrixTerminal: document.getElementById('matrixTerminal'),

      // Alert
      alertBanner: document.getElementById('alertBanner'),
      alertMessage: document.getElementById('alertMessage'),
      alertClose: document.getElementById('alertClose'),
    };
  }

  async init() {
    // Check auth first
    const authed = await Auth.checkAuth();
    if (!authed) {
      window.location.href = '/login';
      return;
    }

    this.attachEvents();
    this.startMatrixRain();
    this.renderMatrixTerminal();
    this.connectWebSocket();
    this.fetchStats();
    this.startAutoRefresh();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopAutoRefresh();
      } else if (this.isAutoRefreshEnabled) {
        this.startAutoRefresh();
        this.fetchStats();
      }
    });
  }

  attachEvents() {
    this.elements.toggleRefresh.addEventListener('click', () => {
      if (this.isAutoRefreshEnabled) {
        this.isAutoRefreshEnabled = false;
        this.stopAutoRefresh();
        this.elements.toggleRefresh.textContent = 'Resume';
      } else {
        this.isAutoRefreshEnabled = true;
        this.startAutoRefresh();
        this.fetchStats();
        this.elements.toggleRefresh.textContent = 'Pause';
      }
    });

    this.elements.refreshNow.addEventListener('click', () => this.fetchStats());
    this.elements.logoutBtn.addEventListener('click', () => Auth.logout());
    this.elements.containerSearch.addEventListener('input', () => this.renderContainers(this.containerData));
    this.elements.containerSort.addEventListener('change', () => this.renderContainers(this.containerData));
    this.elements.alertClose.addEventListener('click', () => {
      this.elements.alertBanner.style.display = 'none';
    });
    window.addEventListener('resize', () => this.sizeMatrixCanvas());
  }

  // ── WebSocket ──────────────────────────────────────────────────
  connectWebSocket() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Authenticate
        const token = Auth.getToken();
        if (token) {
          this.ws.send(JSON.stringify({ type: 'auth', token }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'auth_ok') {
            console.log('WebSocket authenticated');
          } else if (msg.type === 'stats' && msg.data) {
            this.handleSuccess(msg.data);
            this.retries = 0;
          }
        } catch (e) {
          // ignore parse errors
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        // Reconnect after delay
        if (this.isAutoRefreshEnabled) {
          this.wsReconnectTimer = setTimeout(() => this.connectWebSocket(), 5000);
        }
      };

      this.ws.onerror = () => {
        // onclose will fire after this
      };
    } catch (e) {
      console.warn('WebSocket connection failed, falling back to HTTP polling');
    }
  }

  // ── Auto-refresh ───────────────────────────────────────────────
  startAutoRefresh() {
    if (this.intervalId || !this.isAutoRefreshEnabled) return;
    this.intervalId = setInterval(() => {
      // Only HTTP poll if WebSocket is not available
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.fetchStats();
      }
    }, this.refreshInterval);
    this.elements.refreshInfo.textContent = 'Auto-refresh: ON';
    this.elements.refreshInfo.style.color = 'var(--accent-strong)';
  }

  stopAutoRefresh() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.elements.refreshInfo.textContent = 'Auto-refresh: PAUSED';
    this.elements.refreshInfo.style.color = 'var(--accent-warn)';
  }

  // ── HTTP Fetch (fallback) ──────────────────────────────────────
  async fetchStats() {
    try {
      const response = await fetch('/api/stats', {
        headers: { ...Auth.authHeaders(), Accept: 'application/json' },
      });

      if (response.status === 401) {
        // Token expired — redirect to login
        Auth.clearToken();
        window.location.href = '/login';
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      this.handleSuccess(data);
      this.retries = 0;
    } catch (error) {
      console.error('Fetch error:', error);
      this.handleError();
    }
  }

  // ── Data Handling ──────────────────────────────────────────────
  handleSuccess(data) {
    this.elements.connectionStatus.classList.add('connected');
    this.elements.connectionStatus.classList.remove('error');
    this.elements.lastUpdate.textContent = new Date().toLocaleTimeString();

    if (data.error) {
      this.showError(data.error);
      return;
    }

    if (data.cpu) {
      const cpuPercent = Number(data.cpu.usage || 0);
      this.pushHistory('cpu', cpuPercent);
      this.elements.cpuValue.textContent = `${cpuPercent.toFixed(1)}%`;
      this.elements.cpuBar.style.width = `${Math.min(cpuPercent, 100)}%`;
      this.elements.cpuBar.style.backgroundColor = this.getColorForPercent(cpuPercent);
      this.elements.cpuTrendLabel.textContent = this.getTrendLabel(this.history.cpu);
      this.elements.cpuChartReadout.textContent = `${data.cpu.cores || '--'} cores | ${this.getHealthLabel(cpuPercent)}`;
      this.renderSparkline(this.elements.cpuSpark, this.history.cpu);
      this.renderChart(this.elements.cpuChart, this.history.cpu, 'cpu');
    }

    if (data.memory) {
      const memoryPercent = parseFloat(data.memory.percent || 0);
      this.pushHistory('memory', memoryPercent);
      this.elements.memValue.textContent = `${memoryPercent}%`;
      this.elements.memDetail.textContent = `${this.formatBytes(data.memory.used)} / ${this.formatBytes(data.memory.total)}`;
      this.elements.memBar.style.width = `${Math.min(memoryPercent, 100)}%`;
      this.elements.memBar.style.backgroundColor = this.getColorForPercent(memoryPercent);
      this.elements.memTrendLabel.textContent = this.getTrendLabel(this.history.memory);
      this.elements.memChartReadout.textContent = `${this.formatBytes(data.memory.available)} free | ${this.getHealthLabel(memoryPercent)}`;
      this.renderSparkline(this.elements.memSpark, this.history.memory);
      this.renderChart(this.elements.memChart, this.history.memory, 'memory');
    }

    if (data.disk) {
      const diskPercent = parseFloat(data.disk.percent || 0);
      this.elements.diskValue.textContent = `${diskPercent}%`;
      this.elements.diskDetail.textContent = `${data.disk.used} / ${data.disk.total}`;
      this.elements.diskBar.style.width = `${Math.min(diskPercent, 100)}%`;
      this.elements.diskBar.style.backgroundColor = this.getColorForPercent(diskPercent);
    }

    // Network
    if (data.network) {
      this.updateNetwork(data.network);
    }

    // Containers
    if (data.containers) {
      this.containerData = data.containers.list || [];
      this.elements.containerValue.textContent = data.containers.count;
      this.elements.containerCount.textContent = data.containers.count;
      this.elements.containerStatus.textContent = `${data.containers.count} running`;
      this.renderContainers(this.containerData);
    }

    // Container resources
    if (data.containerResources && data.containerResources.length > 0) {
      this.containerResources = data.containerResources;
      this.elements.containerResourcesSection.style.display = '';
      this.elements.containerResCount.textContent = data.containerResources.length;
      this.renderContainerResources(data.containerResources);
    } else {
      this.elements.containerResourcesSection.style.display = 'none';
    }

    if (data.coolify) {
      this.elements.coolifyStatus.textContent = data.coolify;
      this.elements.coolifyStatus.className = 'service-status ' +
        (data.coolify === 'healthy' ? 'healthy' : 'unhealthy');
    }

    if (data.hostname) this.elements.hostname.textContent = data.hostname;
    if (data.uptime) this.elements.uptime.textContent = data.uptime;
    if (data.loadAvg) this.elements.loadavg.textContent = data.loadAvg;

    this.renderMatrixTerminal(data);
    this.checkAlerts(data);
  }

  handleError() {
    this.elements.connectionStatus.classList.remove('connected');
    this.elements.connectionStatus.classList.add('error');
    this.elements.lastUpdate.textContent = 'Connection failed';

    this.retries++;
    if (this.retries >= this.maxRetries) {
      this.stopAutoRefresh();
      this.elements.lastUpdate.textContent = 'Max retries reached. Reload page.';
    }
  }

  // ── Network ────────────────────────────────────────────────────
  updateNetwork(net) {
    if (net.rxPerSec !== undefined) {
      this.elements.netRxValue.textContent = this.formatBits(net.rxPerSec) + '/s';
      this.elements.netTxDetail.textContent = `Tx: ${this.formatBits(net.txPerSec)}/s`;
    }

    // Use rates relative to 100 Mbps as "full scale"
    const maxScale = 12500000; // ~100 Mbps in bytes/s
    const rxPct = Math.min((net.rxPerSec / maxScale) * 100, 100);
    const txPct = Math.min((net.txPerSec / maxScale) * 100, 100);
    this.elements.netRxBar.style.width = `${rxPct}%`;
    this.elements.netTxBar.style.width = `${txPct}%`;
  }

  // ── Container Resources ────────────────────────────────────────
  renderContainerResources(resources) {
    if (!resources || resources.length === 0) {
      this.elements.containerResourcesList.innerHTML = '<div class="empty">No resource data</div>';
      return;
    }

    const html = resources.map((res) => `
      <div class="container-res-item">
        <div class="container-res-name">${this.escapeHtml(res.name)}</div>
        <div class="container-res-metrics">
          <div class="container-res-metric">
            <span class="res-label">CPU</span>
            <div class="res-bar-track">
              <div class="res-bar-fill res-bar-cpu" style="width:${Math.min(res.cpu.usage, 100)}%"></div>
            </div>
            <span class="res-value">${res.cpu.usage.toFixed(1)}%</span>
          </div>
          <div class="container-res-metric">
            <span class="res-label">MEM</span>
            <div class="res-bar-track">
              <div class="res-bar-fill res-bar-mem" style="width:${Math.min(res.memory.percent, 100)}%"></div>
            </div>
            <span class="res-value">${res.memory.percent.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    `).join('');

    this.elements.containerResourcesList.innerHTML = html;
  }

  // ── Alerts ─────────────────────────────────────────────────────
  checkAlerts(data) {
    const alerts = [];
    if (data.cpu && data.cpu.usage > 80) {
      alerts.push(`CPU at ${data.cpu.usage}%`);
    }
    if (data.memory && parseFloat(data.memory.percent) > 80) {
      alerts.push(`Memory at ${data.memory.percent}%`);
    }
    if (data.disk && parseFloat(data.disk.percent) > 85) {
      alerts.push(`Disk at ${data.disk.percent}%`);
    }

    if (alerts.length > 0) {
      this.elements.alertMessage.textContent = `⚠ Threshold breached: ${alerts.join(' · ')}`;
      this.elements.alertBanner.style.display = 'flex';
    } else {
      this.elements.alertBanner.style.display = 'none';
    }
  }

  // ── Containers ─────────────────────────────────────────────────
  renderContainers(containers) {
    if (!containers || containers.length === 0) {
      this.elements.containersList.innerHTML = '<div class="empty">No containers running</div>';
      return;
    }

    const query = this.elements.containerSearch.value.trim().toLowerCase();
    const sortMode = this.elements.containerSort.value;

    const filtered = containers
      .filter((container) => {
        if (!query) return true;
        return (container.name || '').toLowerCase().includes(query) ||
          (container.status || '').toLowerCase().includes(query) ||
          (container.ports || '').toLowerCase().includes(query);
      })
      .sort((a, b) => {
        if (sortMode === 'status') {
          return (a.status || '').localeCompare(b.status || '');
        }
        return (a.name || '').localeCompare(b.name || '');
      });

    if (filtered.length === 0) {
      this.elements.containersList.innerHTML = '<div class="empty">No containers match this filter</div>';
      return;
    }

    const html = filtered.map((container) => {
      const statusText = container.status || 'unknown';
      const isHealthy = statusText.includes('healthy') || statusText.includes('Up');
      const statusClass = isHealthy ? 'healthy' : 'unhealthy';

      return `
        <div class="container-item">
          <div class="container-status ${statusClass}"></div>
          <div class="container-info">
            <div class="container-name">${this.escapeHtml(container.name)}</div>
            <div class="container-ports">${this.escapeHtml(container.ports || 'no ports')}</div>
          </div>
          <div class="container-state ${statusClass}">${this.escapeHtml(statusText.split(' ')[0])}</div>
        </div>
      `;
    }).join('');

    this.elements.containersList.innerHTML = html;
  }

  // ── History ────────────────────────────────────────────────────
  pushHistory(type, value) {
    this.history[type].push(value);
    if (this.history[type].length > this.maxHistoryPoints) {
      this.history[type].shift();
    }
  }

  getTrendLabel(points) {
    if (points.length < 2) return 'stable';
    const previous = points[points.length - 2];
    const current = points[points.length - 1];
    if (current > previous + 2) return 'rising';
    if (current < previous - 2) return 'falling';
    return 'stable';
  }

  getHealthLabel(percent) {
    if (percent < 45) return 'optimal';
    if (percent < 70) return 'watch';
    return 'hot';
  }

  renderSparkline(element, points) {
    if (!element || points.length === 0) return;
    const max = Math.max(...points, 100);

    element.innerHTML = points
      .map((point) => {
        const h = Math.max(8, Math.round((point / max) * 100));
        const color = this.getColorForPercent(point);
        return `<span class="sparkline-bar" style="height:${h}%;background:${color}"></span>`;
      })
      .join('');
  }

  renderChart(element, points, type) {
    if (!element || points.length === 0) return;

    const width = 600;
    const height = 220;
    const padding = 18;
    const max = 100;
    const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

    const linePath = points.map((point, index) => {
      const x = padding + (step * index);
      const y = height - padding - ((point / max) * (height - padding * 2));
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');

    const areaPath = `${linePath} L ${padding + (step * (points.length - 1))} ${height - padding} L ${padding} ${height - padding} Z`;
    const lastPoint = points[points.length - 1];
    const lastX = padding + (step * (points.length - 1));
    const lastY = height - padding - ((lastPoint / max) * (height - padding * 2));
    const stroke = type === 'cpu' ? '#7dffae' : '#7df9ff';
    const fill = type === 'cpu'
      ? 'rgba(125, 255, 174, 0.16)'
      : 'rgba(125, 249, 255, 0.16)';

    element.innerHTML = `
      <defs>
        <filter id="${type}Glow">
          <feGaussianBlur stdDeviation="2.5" result="blur"></feGaussianBlur>
          <feMerge>
            <feMergeNode in="blur"></feMergeNode>
            <feMergeNode in="SourceGraphic"></feMergeNode>
          </feMerge>
        </filter>
      </defs>
      <path d="${areaPath}" fill="${fill}"></path>
      <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" filter="url(#${type}Glow)"></path>
      <circle cx="${lastX.toFixed(2)}" cy="${lastY.toFixed(2)}" r="4.5" fill="${stroke}"></circle>
    `;
  }

  renderMatrixTerminal(data = {}) {
    if (!this.elements.matrixTerminal) return;

    const cpu = this.history.cpu.at(-1);
    const memory = this.history.memory.at(-1);
    const rows = [
      `host :: ${data.hostname || '--'}`,
      `load :: ${data.loadAvg || '--'}`,
      `cpu :: ${cpu !== undefined ? cpu.toFixed(1) + '%' : '--'}`,
      `mem :: ${memory !== undefined ? memory + '%' : '--'}`,
      `disk :: ${this.elements.diskValue.textContent}`,
      `coolify :: ${data.coolify || 'pending'}`,
      `containers :: ${this.elements.containerValue.textContent}`,
      `uptime :: ${data.uptime || '--'}`,
      `vector :: ${this.randomGlyphString(8)}`,
      `signal :: ${this.randomGlyphString(8)}`,
      `trace :: ${this.randomGlyphString(8)}`,
      `clock :: ${new Date().toLocaleTimeString()}`,
    ];

    this.elements.matrixTerminal.innerHTML = rows
      .map((row) => `<div class="matrix-cell">${this.escapeHtml(row)}</div>`)
      .join('');
  }

  // ── Matrix Rain ────────────────────────────────────────────────
  startMatrixRain() {
    const canvas = this.elements.matrixCanvas;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    const fontSize = 14;
    let columns = 0;
    let drops = [];

    const resetDrops = () => {
      columns = Math.max(1, Math.floor(canvas.width / fontSize));
      drops = Array.from({ length: columns }, () => Math.random() * canvas.height / fontSize);
    };

    this.sizeMatrixCanvas();
    resetDrops();

    const draw = () => {
      context.fillStyle = 'rgba(2, 5, 3, 0.11)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#5dff96';
      context.font = `${fontSize}px JetBrains Mono`;

      for (let i = 0; i < drops.length; i++) {
        const text = this.matrixGlyphs.charAt(Math.floor(Math.random() * this.matrixGlyphs.length));
        context.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 1;
      }
      window.requestAnimationFrame(draw);
    };

    window.addEventListener('resize', () => {
      this.sizeMatrixCanvas();
      resetDrops();
    });

    draw();
  }

  sizeMatrixCanvas() {
    const canvas = this.elements.matrixCanvas;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  // ── Helpers ────────────────────────────────────────────────────
  randomGlyphString(length) {
    let output = '';
    for (let i = 0; i < length; i++) {
      output += this.matrixGlyphs.charAt(Math.floor(Math.random() * this.matrixGlyphs.length));
    }
    return output;
  }

  getColorForPercent(percent) {
    if (percent < 50) return 'var(--accent-strong)';
    if (percent < 80) return 'var(--accent-warn)';
    return 'var(--accent-danger)';
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  formatBits(bytesPerSec) {
    const bits = bytesPerSec * 8;
    if (bits === 0) return '0 bps';
    const k = 1000;
    const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
    const i = Math.floor(Math.log(bits) / Math.log(k));
    return parseFloat((bits / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  showError(message) {
    this.elements.containersList.innerHTML = `<div class="empty">Error: ${message}</div>`;
  }
}

// ── Bootstrap ────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new Dashboard());
} else {
  new Dashboard();
}
