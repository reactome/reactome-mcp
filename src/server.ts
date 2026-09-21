import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools, resolveToolGroups } from "./tools/index.js";
import { registerAllResources } from "./resources/index.js";
import { buildServerInstructions } from "./instructions.js";

export const SERVER_NAME = "reactome";
export const SERVER_VERSION = "1.4.0";

/**
 * Build a fully-registered server, with no transport attached.
 *
 * Construction is separate from transport for two reasons. Tests can exercise
 * the real registration path without starting stdio and without the import
 * itself launching a server. And a hosted deployment needs to serve a second
 * transport -- Streamable HTTP -- from the same registrations, which is not
 * possible while the only server instance is created at module scope in the
 * stdio entrypoint.
 */
export function createServer(): McpServer {
  // Resolved once and passed to all three, rather than each asking the
  // environment for itself. They would agree today -- they read the same
  // variable -- but "the same fact, fetched independently in three places"
  // is precisely the shape that let this server advertise tools it had not
  // registered, and it agreed right up until it did not.
  const groups = resolveToolGroups();

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: buildServerInstructions(groups) }
  );

  registerAllTools(server, groups);
  registerAllResources(server, groups);

  return server;
}
