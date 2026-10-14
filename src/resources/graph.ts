import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isGraphAccessEnabled } from "../graph/gate.js";
import { fetchGraphSchema } from "../graph/schema.js";

/**
 * `reactome://graph/schema` -- the graph model as JSON.
 *
 * Not a query surface, but it runs schema procedures against the database on
 * the caller's behalf and publishes the internal graph model, so it sits
 * behind the same gate as the Cypher tools. Checked here as well as through
 * the `cypher` group in registerAllResources, so calling this registrar
 * directly cannot publish it either.
 */
export function registerGraphResources(server: McpServer) {
  if (!isGraphAccessEnabled()) return;

  server.resource("reactome://graph/schema", "reactome://graph/schema", async () => {
    const schema = await fetchGraphSchema();
    return {
      contents: [
        {
          uri: "reactome://graph/schema",
          mimeType: "application/json",
          text: JSON.stringify(schema, null, 2),
        },
      ],
    };
  });
}
