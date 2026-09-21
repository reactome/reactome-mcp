#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./logger.js";
import { CONTENT_SERVICE_URL, ANALYSIS_SERVICE_URL, NEO4J_URI } from "./config.js";
import { fetchGraphSchema } from "./graph/schema.js";
import { isCypherEnabled } from "./clients/neo4j.js";

async function main() {
  // Built here rather than at module scope, so importing this file does not
  // construct a server as a side effect.
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("reactome mcp server started", {
    contentService: CONTENT_SERVICE_URL,
    analysisService: ANALYSIS_SERVICE_URL,
    neo4jEnabled: Boolean(NEO4J_URI),
    cypherEnabled: isCypherEnabled(),
  });

  // Warm the schema cache in the background so the first
  // reactome_cypher_schema call (or reactome://graph/schema read) doesn't
  // wait 15–30s on apoc.meta.schema(). Failures are logged; the cache
  // stays empty and the tool call will retry on demand.
  // Gated on the opt-in, not the connection: without it there is no schema
  // tool and no schema resource, so the prefetch would warm a cache nothing
  // can read and open a Neo4j connection for nobody.
  if (isCypherEnabled()) {
    fetchGraphSchema().catch(err => {
      logger.warn("graph schema prefetch failed; will retry on first use", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

main().catch(error => {
  logger.error("fatal error during startup", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
