import app, { mcpUrls } from "./app";
import "./config/db";
import { shutdownMcpSessions } from "./mcp/mountMcp";

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`🚀 ServicePilot API running on port ${PORT}`);
  console.log(`   MCP endpoint: ${mcpUrls.mcpUrl}`);
  console.log(`   OAuth authorize: ${mcpUrls.authorizeUrl}`);
  console.log(`   OAuth login UI: ${mcpUrls.oauthLoginUrl}`);
});

process.on("SIGINT", async () => {
  await shutdownMcpSessions();
  process.exit(0);
});