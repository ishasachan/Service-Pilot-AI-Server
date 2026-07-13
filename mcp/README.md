# ServicePilot AI Copilot — Unified MCP

One MCP server with **OAuth login** and **role-based tools** (advisor vs driver).

## Quick start

```bash
cd server
npm run mcp
```

| URL | Purpose |
|-----|---------|
| `http://127.0.0.1:5002/mcp` | MCP Streamable HTTP endpoint |
| `http://127.0.0.1:5002/authorize` | OAuth authorize (redirects to login) |
| `http://localhost:5173/oauth/login` | Login UI (same design as app) |
| `http://127.0.0.1:5002/health` | Health check |

## MCP Inspector (with OAuth)

1. Start MCP: `npm run mcp`
2. Start frontend: `cd client && npm run dev`
3. Run Inspector: `npx @modelcontextprotocol/inspector`
4. Connect with:
   - **Transport:** Streamable HTTP
   - **URL:** `http://127.0.0.1:5002/mcp`
5. Inspector triggers OAuth → browser opens `/oauth/login`
6. Sign in as **advisor** or **driver** → tools match your role

## Claude / ChatGPT

Add MCP server URL: `http://127.0.0.1:5002/mcp`

Clients discover OAuth via `/.well-known/oauth-protected-resource/mcp` and redirect to the same login page.

## Tools by role

### Advisor (14 tools)
`find_booking`, `get_booking_details`, `get_pending_bookings`, `schedule_pickup`, `assign_driver`, `get_customer_history`, `get_available_drivers`, `dashboard_summary`, `today_bookings`, `driver_performance`, `priority_breakdown`, `notify_driver`

### Driver (7 tools)
`get_driver_jobs`, `get_next_job`, `advance_job_status`, `get_booking_details`, `driver_statistics`, `get_notifications`, `mark_notification_read`

## Architecture

```
Claude / ChatGPT / Inspector
        ↓ OAuth
http://127.0.0.1:5002/mcp
        ↓ role-based tools
mcp/services/* (booking, driver, dashboard, notification)
        ↓
Supabase
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run mcp` | Unified MCP + OAuth (port 5002) |
| `npm run mcp:test:tools` | Smoke-test all service operations |

## Env

**server/.env**
```
MCP_PORT=5002
MCP_BASE_URL=http://127.0.0.1:5002
MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL=true
FRONTEND_URL=http://localhost:5173
```

**client/.env**
```
VITE_MCP_URL=http://127.0.0.1:5002
```
