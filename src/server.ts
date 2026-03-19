import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";

export function createServer() {
  const server = new McpServer({
    name: "reactome",
    version: "1.0.0",
  });

  registerAllTools(server);
  registerAllResources(server);

  return server;
}
