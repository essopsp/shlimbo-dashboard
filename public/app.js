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
        this.matrixGlyphs = '01アカサタナハマヤラワ0123456789ABCDEF';
        this.elements = this.cacheElements();
        this.init();
    }

    cacheElements() {
        return {
            matrixCanvas: document.getElementById('matrixCanvas'),
            matrixTerminal: document.getElementById('matrixTerminal'),
            cpuValue: document.getElementById('cpuValue'),
            cpuBar: document.getElementById('cpuBar'),
            cpuSpark: document.getElementById('cpuSpark'),
            cpuTrendLabel: document.getElementById('cpuTrendLabel'),
            cpuChart: document.getElementById('cpuChart'),
            cpuChartReadout: document.getElementById('cpuChartReadout'),
            memValue: document.getElementById('memValue'),
            memDetail: document.getElementById('memDetail'),
            memBar: document.getElementById('memBar'),
            memSpark: document.getElementById('memSpark'),
            memTrendLabel: document.getElementById('memTrendLabel'),
            memChart: document.getElementById('memChart'),
            memChartReadout: document.getElementById('memChartReadout'),
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
        this.startMatrixRain();
        this.renderMatrixTerminal();
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
        window.addEventListener('resize', () => this.sizeMatrixCanvas());
    }

    startAutoRefresh() {
        if (this.intervalId || !this.isAutoRefreshEnabled) return;
        this.intervalId = setInterval(() => this.fetchStats(), this.refreshInterval);
        this.elements.refreshInfo.textContent = 'Auto-refresh: ON';
        this.elements.refreshInfo.style.color = 'var(--accent-strong)';
    }

    stopAutoRefresh() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.elements.refreshInfo.textContent = 'Auto-refresh: PAUSED';
        this.elements.refreshInfo.style.color = 'var(--accent-warn)';
    }

    async fetchStats() {
        try {
            const response = await fetch('/api/stats', {
                headers: { Accept: 'application/json' }
            });

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

        this.renderMatrixTerminal(data);
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
            `clock :: ${new Date().toLocaleTimeString()}`
        ];

        this.elements.matrixTerminal.innerHTML = rows
            .map((row) => `<div class="matrix-cell">${this.escapeHtml(row)}</div>`)
            .join('');
    }

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
