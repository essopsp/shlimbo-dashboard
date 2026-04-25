class Dashboard {
    constructor() {
        this.refreshInterval = 2000;
        this.retryDelay = 5000;
        this.maxRetries = 3;
        this.retries = 0;
        this.intervalId = null;
        this.isAutoRefreshEnabled = true;
        this.containerData = [];
        this.history = {
            cpu: [],
            memory: []
        };
        this.maxHistoryPoints = 20;
        this.elements = this.cacheElements();
        this.init();
    }

    cacheElements() {
        return {
            cpuValue: document.getElementById('cpuValue'),
            cpuBar: document.getElementById('cpuBar'),
            cpuSpark: document.getElementById('cpuSpark'),
            cpuTrendLabel: document.getElementById('cpuTrendLabel'),
            memValue: document.getElementById('memValue'),
            memDetail: document.getElementById('memDetail'),
            memBar: document.getElementById('memBar'),
            memSpark: document.getElementById('memSpark'),
            memTrendLabel: document.getElementById('memTrendLabel'),
            diskValue: document.getElementById('diskValue'),
            diskDetail: document.getElementById('diskDetail'),
            diskBar: document.getElementById('diskBar'),
            containerValue: document.getElementById('containerValue'),
            containerStatus: document.getElementById('containerStatus'),
            containerCount: document.getElementById('containerCount'),
            containerSearch: document.getElementById('containerSearch'),
            containerSort: document.getElementById('containerSort'),
            containersList: document.getElementById('containersList'),
            coolifyStatus: document.getElementById('coolifyStatus'),
            hostname: document.getElementById('hostname'),
            uptime: document.getElementById('uptime'),
            loadavg: document.getElementById('loadavg'),
            connectionStatus: document.getElementById('connectionStatus'),
            lastUpdate: document.getElementById('lastUpdate'),
            refreshInfo: document.getElementById('refreshInfo'),
            toggleRefresh: document.getElementById('toggleRefresh'),
            refreshNow: document.getElementById('refreshNow')
        };
    }

    init() {
        this.attachEvents();
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
        this.elements.containerSearch.addEventListener('input', () => this.renderContainers(this.containerData));
        this.elements.containerSort.addEventListener('change', () => this.renderContainers(this.containerData));
    }

    startAutoRefresh() {
        if (this.intervalId || !this.isAutoRefreshEnabled) return;
        this.intervalId = setInterval(() => this.fetchStats(), this.refreshInterval);
        this.elements.refreshInfo.textContent = 'Auto-refresh: ON';
        this.elements.refreshInfo.style.color = 'var(--accent-green)';
    }

    stopAutoRefresh() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.elements.refreshInfo.textContent = 'Auto-refresh: PAUSED';
        this.elements.refreshInfo.style.color = 'var(--accent-yellow)';
    }

    async fetchStats() {
        try {
            const response = await fetch('/api/stats', {
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            this.handleSuccess(data);
            this.retries = 0;

        } catch (error) {
            console.error('Fetch error:', error);
            this.handleError(error);
        }
    }

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
            this.renderSparkline(this.elements.cpuSpark, this.history.cpu);
        }

        if (data.memory) {
            const memoryPercent = parseFloat(data.memory.percent || 0);
            this.pushHistory('memory', memoryPercent);
            this.elements.memValue.textContent = `${memoryPercent}%`;
            this.elements.memDetail.textContent = `${this.formatBytes(data.memory.used)} / ${this.formatBytes(data.memory.total)}`;
            this.elements.memBar.style.width = `${Math.min(memoryPercent, 100)}%`;
            this.elements.memBar.style.backgroundColor = this.getColorForPercent(memoryPercent);
            this.elements.memTrendLabel.textContent = this.getTrendLabel(this.history.memory);
            this.renderSparkline(this.elements.memSpark, this.history.memory);
        }

        if (data.disk) {
            const diskPercent = parseFloat(data.disk.percent || 0);
            this.elements.diskValue.textContent = `${diskPercent}%`;
            this.elements.diskDetail.textContent = `${data.disk.used} / ${data.disk.total}`;
            this.elements.diskBar.style.width = `${Math.min(diskPercent, 100)}%`;
            this.elements.diskBar.style.backgroundColor = this.getColorForPercent(diskPercent);
        }

        if (data.containers) {
            this.containerData = data.containers.list || [];
            this.elements.containerValue.textContent = data.containers.count;
            this.elements.containerCount.textContent = data.containers.count;
            this.elements.containerStatus.textContent = `${data.containers.count} running`;
            this.renderContainers(this.containerData);
        }

        if (data.coolify) {
            this.elements.coolifyStatus.textContent = data.coolify;
            this.elements.coolifyStatus.className = 'service-status ' +
                (data.coolify === 'healthy' ? 'healthy' : 'unhealthy');
        }

        if (data.hostname) this.elements.hostname.textContent = data.hostname;
        if (data.uptime) this.elements.uptime.textContent = data.uptime;
        if (data.loadAvg) this.elements.loadavg.textContent = data.loadAvg;
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

    showError(message) {
        this.elements.containersList.innerHTML = `<div class="empty">Error: ${message}</div>`;
    }

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

    renderSparkline(element, points) {
        if (!element || points.length === 0) return;
        const max = Math.max(...points, 100);

        element.innerHTML = points
            .map((point) => {
                const h = Math.max(6, Math.round((point / max) * 100));
                const color = this.getColorForPercent(point);
                return `<span class="sparkline-bar" style="height:${h}%;background:${color}"></span>`;
            })
            .join('');
    }

    getColorForPercent(percent) {
        if (percent < 50) return 'var(--accent-green)';
        if (percent < 80) return 'var(--accent-yellow)';
        return 'var(--accent-red)';
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new Dashboard());
} else {
    new Dashboard();
}
