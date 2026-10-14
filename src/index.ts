#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./logger.js";
import { CONTENT_SERVICE_URL, ANALYSIS_SERVICE_URL } from "./config.js";
import { GRAPH_GROUP, resolveToolGroups } from "./tools/index.js";
import { warmGraphSchema } from "./graph/warmup.js";

async function main() {
  // Built here rather than at module scope, so importing this file does not
  // construct a server as a side effect.
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("reactome mcp server started", {
    contentService: CONTENT_SERVICE_URL,
    analysisService: ANALYSIS_SERVICE_URL,
    // Whether this instance offers the Cypher tools -- the gate, and the group.
    graphAccess: resolveToolGroups().includes(GRAPH_GROUP),
  });
  warmGraphSchema();
}

if (process.argv[2] === "extract-schema") {
  // An operator command, not the server: no server is built and no transport
  // opened. `process.exitCode` rather than `process.exit()`, so the JSON
  // written to stdout drains before the process ends.
  import("./cli/extract-schema.js")
    .then(({ runExtractSchema }) => runExtractSchema(process.argv.slice(3)))
    .then(code => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      logger.error("extract-schema failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    });
} else {
  main().catch(error => {
    logger.error("fatal error during startup", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
