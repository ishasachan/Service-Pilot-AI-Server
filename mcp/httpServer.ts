/**
 * ServicePilot AI Copilot — Unified MCP (Streamable HTTP + OAuth)
 *
 * Run: npm run mcp:http
 * Inspector: Streamable HTTP → http://127.0.0.1:5002/mcp (OAuth required)
 */
import { randomUUID } from "node:crypto";

import cors from "cors";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Request, Response } from "express";

import "./shared/loadEnv";

import {
  getAuthContext,
  ServicePilotOAuthProvider,
} from "./auth/provider";
import { createServicePilotMcpServer } from "./createServer";

const MCP_PORT = Number(process.env.MCP_PORT ?? process.env.MCP_BOOKING_PORT ?? 5002);
const MCP_BASE_URL = process.env.MCP_BASE_URL ?? `http://127.0.0.1:${MCP_PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

if (!process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL) {
  process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL = "true";
}

const issuerUrl = new URL(MCP_BASE_URL);
const resourceServerUrl = new URL(`${MCP_BASE_URL}/mcp`);
const oauthProvider = new ServicePilotOAuthProvider();

const app = createMcpExpressApp({ host: "127.0.0.1" });

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl,
    baseUrl: issuerUrl,
    scopesSupported: ["mcp:tools"],
    resourceServerUrl,
    resourceName: "ServicePilot AI Copilot",
    serviceDocumentationUrl: new URL(FRONTEND_URL),
  }),
);

const resourceMetadataUrl =
  getOAuthProtectedResourceMetadataUrl(resourceServerUrl);

const authMiddleware = requireBearerAuth({
  verifier: oauthProvider,
  resourceMetadataUrl,
});

const transports: Record<string, StreamableHTTPServerTransport> = {};

type AuthedRequest = Request & { auth?: AuthInfo };

/** Extracts the authenticated user from the bearer token on MCP requests. */
function resolveUser(req: AuthedRequest) {
  const user = getAuthContext(req.auth);
  if (!user || !user.id) {
    return null;
  }
  return user;
}

/** Frontend calls this after login to finish OAuth and get the redirect URL with auth code. */
app.post("/api/oauth/complete", async (req, res) => {
  try {
    const { oauth_pending, email, password, role } = req.body ?? {};

    if (!oauth_pending || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "oauth_pending, email, password, and role are required",
      });
    }

    if (role !== "advisor" && role !== "driver") {
      return res.status(400).json({
        success: false,
        message: "role must be advisor or driver",
      });
    }

    const result = await oauthProvider.completeLogin({
      oauthPending: oauth_pending,
      email,
      password,
      role,
    });

    return res.json({
      success: true,
      redirectUrl: result.redirectUrl,
      user: result.user,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OAuth login failed";
    return res.status(400).json({ success: false, message });
  }
});

/** Handles MCP JSON-RPC POST requests (initialize + tool calls). */
async function handleMcpPost(req: AuthedRequest, res: Response) {
  const sessionId = req.headers["mcp-session-id"];

  try {
    const user = resolveUser(req);
    if (!user) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Unauthorized" },
        id: null,
      });
    }

    let transport: StreamableHTTPServerTransport | undefined;

    if (typeof sessionId === "string" && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport!;
        },
      });

      transport.onclose = () => {
        const id = transport?.sessionId;
        if (id && transports[id]) {
          delete transports[id];
        }
      };

      const server = createServicePilotMcpServer(user);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("ServicePilot MCP HTTP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

/** Handles MCP SSE GET streams for an existing session. */
async function handleMcpGet(req: AuthedRequest, res: Response) {
  const sessionId = req.headers["mcp-session-id"];

  if (typeof sessionId !== "string" || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  await transports[sessionId].handleRequest(req, res);
}

/** Handles MCP session termination (DELETE). */
async function handleMcpDelete(req: AuthedRequest, res: Response) {
  const sessionId = req.headers["mcp-session-id"];

  if (typeof sessionId !== "string" || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  await transports[sessionId].handleRequest(req, res);
}

/** Health check endpoint for verifying MCP server is running. */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "servicepilot-copilot-mcp",
    transport: "streamable-http",
    oauth: true,
    endpoint: "/mcp",
    port: MCP_PORT,
    issuer: issuerUrl.href,
    resource: resourceServerUrl.href,
  });
});

app.post("/mcp", authMiddleware, handleMcpPost);
app.get("/mcp", authMiddleware, handleMcpGet);
app.delete("/mcp", authMiddleware, handleMcpDelete);

app.listen(MCP_PORT, "127.0.0.1", () => {
  console.log(`ServicePilot MCP listening on ${MCP_BASE_URL}/mcp`);
  console.log(`OAuth authorize: ${MCP_BASE_URL}/authorize`);
  console.log(`OAuth login UI: ${FRONTEND_URL}/oauth/login`);
  console.log(`Health: ${MCP_BASE_URL}/health`);
});

process.on("SIGINT", async () => {
  for (const sessionId of Object.keys(transports)) {
    try {
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Failed to close MCP session ${sessionId}:`, error);
    }
  }
  process.exit(0);
});
