import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStaticResources } from "./static.js";
import { registerResourceTemplates } from "./templates.js";

export function registerAllResources(server: McpServer) {
  registerStaticResources(server);
  registerResourceTemplates(server);
}
