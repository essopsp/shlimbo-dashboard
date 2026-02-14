# Shlimbo Dashboard

Real-time server dashboard for Coolify environment. Monitors CPU, memory, disk, Docker containers, and Coolify health status.

## Features

- 📊 Real-time CPU, memory, disk monitoring
- 🐳 Docker container status
- 📱 Mobile-friendly responsive design
- 🔄 Auto-refresh every 2 seconds
- 🎨 Dark theme with colored status indicators

## Screenshots

<img src="https://via.placeholder.com/300x600/0f172a/3b82f6?text=Mobile+View" width="200">
<img src="https://via.placeholder.com/600x400/0f172a/3b82f6?text=Desktop+View" width="400">

## Quick Start

### With Docker

```bash
docker-compose up -d
```

Access at `http://localhost:3001`

### Direct Node.js

```bash
npm install
npm start
```

Access at `http://localhost:3000`

## Deploy to Coolify

1. Push this repo to GitHub
2. In Coolify: Create new resource → GitHub → Select this repo
3. Set build command: `docker build -t dashboard .`
4. Set start command: `node server.js`
5. Add Docker socket volume: `/var/run/docker.sock:/var/run/docker.sock:ro`
6. Deploy

## Environment Variables

- `PORT` - Server port (default: 3000)
- `RESTART_TOKEN` - Optional token for container restart API

## API Endpoints

- `GET /api/stats` - System stats (JSON)
- `GET /health` - Health check
- `POST /api/container/:name/restart` - Restart container (requires token)

## License

MIT
