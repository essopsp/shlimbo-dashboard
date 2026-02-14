class Dashboard {
    constructor() {
        this.refreshInterval = 2000;
        this.retryDelay = 5000;
        this.maxRetries = 3;
        this.retries = 0;
        this.intervalId = null;
        this.elements = this.cacheElements();
        this.init();
    }

    cacheElements() {
        return {
            cpuValue: document.getElementById('cpuValue'),
            cpuBar: document.getElementById('cpuBar'),
            memValue: document.getElementById('memValue'),
            memDetail: document.getElementById('memDetail'),
            memBar: document.getElementById('memBar'),
            diskValue: document.getElementById('diskValue'),
            diskDetail: document.getElementById('diskDetail'),
            diskBar: document.getElementById('diskBar'),
            containerValue: document.getElementById('containerValue'),
            containerStatus: document.getElementById('containerStatus'),
            containerCount: document.getElementById('containerCount'),
            containersList: document.getElementById('containersList'),
            coolifyStatus: document.getElementById('coolifyStatus'),
            hostname: document.getElementById('hostname'),
            uptime: document.getElementById('uptime'),
            loadavg: document.getElementById('loadavg'),
            connectionStatus: document.getElementById('connectionStatus'),
            lastUpdate: document.getElementById('lastUpdate'),
            refreshInfo: document.getElementById('refreshInfo')
        };
    }

    init() {
        this.fetchStats();
        this.startAutoRefresh();
        
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopAutoRefresh();
            } else {
                this.startAutoRefresh();
                this.fetchStats();
            }
        });
    }

    startAutoRefresh() {
        if (this.intervalId) return;
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
            this.elements.cpuValue.textContent = `${data.cpu.usage.toFixed(1)}%`;
            this.elements.cpuBar.style.width = `${Math.min(data.cpu.usage, 100)}%`;
            this.elements.cpuBar.style.backgroundColor = this.getColorForPercent(data.cpu.usage);
        }

        if (data.memory) {
            this.elements.memValue.textContent = `${data.memory.percent}%`;
            this.elements.memDetail.textContent = `${this.formatBytes(data.memory.used)} / ${this.formatBytes(data.memory.total)}`;
            this.elements.memBar.style.width = `${Math.min(parseFloat(data.memory.percent), 100)}%`;
            this.elements.memBar.style.backgroundColor = this.getColorForPercent(parseFloat(data.memory.percent));
        }

        if (data.disk) {
            this.elements.diskValue.textContent = `${data.disk.percent}%`;
            this.elements.diskDetail.textContent = `${data.disk.used} / ${data.disk.total}`;
            this.elements.diskBar.style.width = `${Math.min(parseFloat(data.disk.percent), 100)}%`;
            this.elements.diskBar.style.backgroundColor = this.getColorForPercent(parseFloat(data.disk.percent));
        }

        if (data.containers) {
            this.elements.containerValue.textContent = data.containers.count;
            this.elements.containerCount.textContent = data.containers.count;
            this.elements.containerStatus.textContent = `${data.containers.count} running`;
            this.renderContainers(data.containers.list);
        }

        if (data.coolify) {
            this.elements.coolifyStatus.textContent = data.coolify;
            this.elements.coolifyStatus.className = 'service-status ' + 
                (data.coolify === 'healthy' ? 'healthy' : 'unhealthy');
        }

        if (data.hostname) {
            this.elements.hostname.textContent = data.hostname;
        }

        if (data.uptime) {
            this.elements.uptime.textContent = data.uptime;
        }

        if (data.loadAvg) {
            this.elements.loadavg.textContent = data.loadAvg;
        }
    }

    handleError(error) {
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
        this.elements.containersList.innerHTML = 
            `<div class="empty">Error: ${message}</div>`;
    }

    renderContainers(containers) {
        if (!containers || containers.length === 0) {
            this.elements.containersList.innerHTML = 
                '<div class="empty">No containers running</div>';
            return;
        }

        const html = containers.map(container => {
            const isHealthy = container.status.includes('healthy') || 
                            container.status.includes('Up');
            const statusClass = isHealthy ? 'healthy' : 'unhealthy';
            
            return `
                <div class="container-item">
                    <div class="container-status ${statusClass}"></div>
                    <div class="container-info">
                        <div class="container-name">${this.escapeHtml(container.name)}</div>
                        <div class="container-ports">${this.escapeHtml(container.ports || 'no ports')}</div>
                    </div>
                    <div class="container-state">${this.escapeHtml(container.status.split(' ')[0])}</div>
                </div>
            `;
        }).join('');

        this.elements.containersList.innerHTML = html;
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
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize dashboard when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new Dashboard());
} else {
    new Dashboard();
}

