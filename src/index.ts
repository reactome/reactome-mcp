#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { logger } from "./logger.js";
import { CONTENT_SERVICE_URL, ANALYSIS_SERVICE_URL, NEO4J_URI } from "./config.js";

const server = new McpServer({
  name: "reactome",
  version: "1.1.0",
});

registerAllTools(server);
registerAllResources(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("reactome mcp server started", {
    contentService: CONTENT_SERVICE_URL,
    analysisService: ANALYSIS_SERVICE_URL,
    neo4jEnabled: Boolean(NEO4J_URI),
  });
}

main().catch((error) => {
  logger.error("fatal error during startup", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
