/**
 * Mounts ServicePilot MCP (Streamable HTTP + OAuth) on an existing Express app.
 * Used by the main API server so API and MCP share one port (Render-friendly).
 */
import { randomUUID } from "node:crypto";

import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Express, Request, Response } from "express";

import {
  getAuthContext,
  ServicePilotOAuthProvider,
} from "./auth/provider";
import { createServicePilotMcpServer } from "./createServer";

const oauthProvider = new ServicePilotOAuthProvider();
const transports: Record<string, StreamableHTTPServerTransport> = {};

type AuthedRequest = Request & { auth?: AuthInfo };

function getPublicBaseUrl(): string {
  if (process.env.MCP_BASE_URL) {
    return process.env.MCP_BASE_URL.replace(/\/$/, "");
  }
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL.replace(/\/$/, "");
  }
  const port = process.env.PORT ?? "5001";
  return `http://127.0.0.1:${port}`;
}

/** Extracts the authenticated user from the bearer token on MCP requests. */
function resolveUser(req: AuthedRequest) {
  const user = getAuthContext(req.auth);
  if (!user || !user.id) {
    return null;
  }
  return user;
}

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

/**
 * Attaches MCP, OAuth, and related routes to the main Express application.
 *
 * @param app - Main ServicePilot Express app.
 * @returns Public URLs for logging and env verification.
 */
export function mountServicePilotMcp(app: Express) {
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const baseUrl = getPublicBaseUrl();

  if (!process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL) {
    process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL = "true";
  }

  const issuerUrl = new URL(`${baseUrl}/`);
  const resourceServerUrl = new URL(`${baseUrl}/mcp`);

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      baseUrl: issuerUrl,
      scopesSupported: ["mcp:tools"],
      resourceServerUrl,
      resourceName: "ServicePilot AI Copilot",
      serviceDocumentationUrl: new URL(frontendUrl),
    }),
  );

  const resourceMetadataUrl =
    getOAuthProtectedResourceMetadataUrl(resourceServerUrl);

  const authMiddleware = requireBearerAuth({
    verifier: oauthProvider,
    resourceMetadataUrl,
  });

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

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "servicepilot-api-mcp",
      transport: "streamable-http",
      oauth: true,
      api: "/api",
      mcp: "/mcp",
      issuer: issuerUrl.href,
      resource: resourceServerUrl.href,
    });
  });

  app.post("/mcp", authMiddleware, handleMcpPost);
  app.get("/mcp", authMiddleware, handleMcpGet);
  app.delete("/mcp", authMiddleware, handleMcpDelete);

  return {
    baseUrl,
    mcpUrl: resourceServerUrl.href,
    authorizeUrl: `${baseUrl}/authorize`,
    oauthLoginUrl: `${frontendUrl}/oauth/login`,
  };
}

/** Closes all active MCP Streamable HTTP sessions (for graceful shutdown). */
export async function shutdownMcpSessions() {
  for (const sessionId of Object.keys(transports)) {
    try {
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Failed to close MCP session ${sessionId}:`, error);
    }
  }
}
