#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { logger } from "./logger.js";
import { CONTENT_SERVICE_URL, ANALYSIS_SERVICE_URL, NEO4J_URI } from "./config.js";
import { buildServerInstructions } from "./instructions.js";
import { fetchGraphSchema } from "./graph/schema.js";

const server = new McpServer(
  { name: "reactome", version: "1.4.0" },
  { instructions: buildServerInstructions() }
);

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

  // Warm the schema cache in the background so the first
  // reactome_cypher_schema call (or reactome://graph/schema read) doesn't
  // wait 15–30s on apoc.meta.schema(). Failures are logged; the cache
  // stays empty and the tool call will retry on demand.
  if (NEO4J_URI) {
    fetchGraphSchema().catch((err) => {
      logger.warn("graph schema prefetch failed; will retry on first use", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

main().catch((error) => {
  logger.error("fatal error during startup", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
