import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStaticResources } from "./static.js";
import { registerResourceTemplates } from "./templates.js";
import { resolveToolGroups, type ToolGroup } from "../tools/index.js";

/**
 * Which group each resource belongs to.
 *
 * Resources are the third surface that has to agree with `MCP_TOOL_GROUPS`,
 * after the tools themselves and the server instructions. An instance that
 * withholds `analysis` but still serves `reactome://analysis/{token}` has not
 * restricted anything -- it has moved the same capability to a URI. The
 * resources are the same fetches the tools make.
 *
 * A URI missing from this table throws at registration rather than
 * defaulting to always-on, so a new resource cannot escape the switch by
 * nobody remembering it exists.
 */
const RESOURCE_GROUPS: Record<string, ToolGroup> = {
  "reactome://species": "utilities",
  "reactome://species/main": "utilities",
  "reactome://diseases": "utilities",
  "reactome://database/info": "utilities",
  "reactome://pathway/{id}": "pathway",
  "reactome://pathway/{id}/diagram": "export",
  "reactome://entity/{id}": "entity",
  "reactome://analysis/{token}": "analysis",
  "reactome://top-pathways/{species}": "pathway",
  "reactome://events-hierarchy/{species}": "pathway",
};

export const RESOURCE_URIS = Object.keys(RESOURCE_GROUPS);

/** The URI a `server.resource(...)` call registers, static or templated. */
function uriOf(args: unknown[]): string | undefined {
  // Static: (uri, uri, handler) -- the name and the URI are the same string.
  if (typeof args[1] === "string") return args[1];
  // Templated: (name, ResourceTemplate, options, handler).
  const template = args[1] as { uriTemplate?: { toString(): string } } | undefined;
  return template?.uriTemplate?.toString();
}

export function registerAllResources(server: McpServer, groups: ToolGroup[] = resolveToolGroups()) {
  const original = server.resource.bind(server);
  (server as unknown as { resource: (...a: unknown[]) => unknown }).resource = (
    ...args: unknown[]
  ) => {
    const uri = uriOf(args);
    const group = uri === undefined ? undefined : RESOURCE_GROUPS[uri];
    if (group === undefined) {
      throw new Error(
        `Resource ${uri ?? "(unrecognised registration)"} is not assigned to a tool group. ` +
          `Add it to RESOURCE_GROUPS in src/resources/index.ts so MCP_TOOL_GROUPS can govern it.`
      );
    }
    if (!groups.includes(group)) return undefined;
    return (original as (...a: unknown[]) => unknown)(...args);
  };

  registerStaticResources(server);
  registerResourceTemplates(server);
}
