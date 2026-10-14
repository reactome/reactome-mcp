#!/usr/bin/env node
/**
 * HTTP entrypoint. `src/index.ts` remains the stdio one and is unchanged --
 * every existing user has a client configured to spawn it, and that must keep
 * working exactly as before.
 *
 *   MCP_HTTP_PORT=4320 node dist/http-server.js
 *
 * Binds 127.0.0.1 unless MCP_HTTP_HOST says otherwise. See config.ts for why
 * that default is what it is.
 */
import { startHttpServer } from "./http.js";
import { logger } from "./logger.js";
import { MCP_HTTP_PORT, MCP_HTTP_HOST } from "./config.js";
import { warmGraphSchema } from "./graph/warmup.js";

const port = MCP_HTTP_PORT;

if (!port) {
  logger.error("MCP_HTTP_PORT is not set", {
    hint: "Set MCP_HTTP_PORT to serve over HTTP, or run dist/index.js for stdio.",
  });
  process.exit(1);
}

// `Promise.resolve().then(...)` rather than a bare call: startHttpServer
// validates the tool-group configuration synchronously, so a bad value threw
// past the .catch below and killed the process with a raw stack trace. Dying
// was correct; dying without the log line that says why was not.
//
// The graph schema warm-up decides for itself whether graph access is on --
// this entrypoint once decided by NEO4J_URI alone, and opened a connection on
// an instance that had not opted in.
Promise.resolve()
  .then(() => startHttpServer(port, MCP_HTTP_HOST))
  .then(() => warmGraphSchema())
  .catch((error: unknown) => {
    logger.error("fatal error starting http server", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
