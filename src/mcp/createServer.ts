import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ServicePilotUser } from "./auth/provider";
import { registerServicePilotTools } from "./tools/registerTools";

/**
 * Creates an MCP server instance with tools scoped to the authenticated user.
 *
 * @param user - Logged-in advisor or driver from OAuth token.
 * @returns Configured MCP server ready to connect to a transport.
 */
export function createServicePilotMcpServer(user: ServicePilotUser) {
  const server = new McpServer({
    name: "servicepilot-copilot",
    version: "1.0.0",
  });

  registerServicePilotTools(server, user);

  return server;
}
