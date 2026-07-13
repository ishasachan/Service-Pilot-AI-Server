# ServicePilot AI Copilot — Unified MCP

MCP runs on the **same Express server** as the REST API (one port — Render-friendly).

## Quick start

```bash
cd server
npm run dev
```

| URL | Purpose |
|-----|---------|
| `http://127.0.0.1:5001/api/*` | REST API |
| `http://127.0.0.1:5001/mcp` | MCP Streamable HTTP |
| `http://127.0.0.1:5001/authorize` | OAuth authorize |
| `http://localhost:5173/oauth/login` | Login UI |
| `http://127.0.0.1:5001/health` | Health check |

## MCP Inspector (with OAuth)

1. Start server: `npm run dev`
2. Start frontend: `cd client && npm run dev`
3. Run Inspector: `npx @modelcontextprotocol/inspector`
4. Connect with **Streamable HTTP** → `http://127.0.0.1:5001/mcp`

## Tools by role

### Advisor (12 tools)
`find_booking`, `get_booking_details`, `get_pending_bookings`, `schedule_pickup`, `assign_driver`, `get_customer_history`, `get_available_drivers`, `dashboard_summary`, `today_bookings`, `driver_performance`, `priority_breakdown`, `notify_driver`

### Driver (7 tools)
`get_driver_jobs`, `get_next_job`, `advance_job_status`, `get_booking_details`, `driver_statistics`, `get_notifications`, `mark_notification_read`

## Architecture

```
Claude / ChatGPT / Inspector
        ↓ OAuth
http://your-app.onrender.com/mcp   (same process as /api)
        ↓ role-based tools
src/mcp/services/*
        ↓
Supabase
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | API + MCP on one port |
| `npm run build && npm start` | Production (Render) |
| `npm run mcp:test:tools` | Smoke-test all MCP operations |

## Env

**server/.env**
```
PORT=5001
FRONTEND_URL=http://localhost:5173
MCP_BASE_URL=http://127.0.0.1:5001
MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL=true
```

**client/.env** (MCP OAuth uses same host as API)
```
VITE_API_URL=http://localhost:5001
VITE_MCP_URL=http://localhost:5001
```

**Render production**
```
PORT=<set by Render>
MCP_BASE_URL=https://your-app.onrender.com
FRONTEND_URL=https://your-frontend.vercel.app
```
