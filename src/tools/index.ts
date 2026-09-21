import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../logger.js";
import { z } from "zod";
import { nonEmptyString } from "../schemas.js";
import { contentClient } from "../clients/content.js";
import type { Species, Disease, Pathway } from "../types/index.js";

import { registerAnalysisTools } from "./analysis.js";
import { registerPathwayTools } from "./pathway.js";
import { registerSearchTools } from "./search.js";
import { registerEntityTools } from "./entity.js";
import { registerExportTools } from "./export.js";
import { registerInteractorTools } from "./interactors.js";
import { registerGsaTools } from "./gsa.js";
import { withNewRequestContext } from "../context.js";
import { capToolResult } from "../response-limits.js";
import { MAX_TOOL_RESPONSE_CHARS } from "../config.js";

/**
 * Wrap `server.tool` so every handler runs inside a fresh request context.
 * The context carries a short reqId that the logger auto-includes in every
 * log line emitted during that invocation — giving one correlation handle
 * across tool → client → retry → error log.
 */
/**
 * Wrap every tool handler once, at registration.
 *
 * Two things ride here: a fresh request context so log lines from one call can
 * be grepped together, and a cap on how much text the call may return. The cap
 * belongs at this single point rather than in 56 handlers -- a per-tool guard
 * is a guard somebody forgets to add to the fifty-seventh.
 */
function installToolWrapper(server: McpServer) {
  const original = server.tool.bind(server);
  // The SDK's tool() is an overloaded method; we only ever call the 4-arg
  // form (name, description, schema, handler). Keep the wrapper permissive.
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (...args: unknown[]) => {
    const handler = args[args.length - 1];
    if (typeof handler !== "function") {
      return (original as (...a: unknown[]) => unknown)(...args);
    }
    const toolName = typeof args[0] === "string" ? args[0] : "tool";
    const wrapped = async (params: unknown) => {
      const result = await withNewRequestContext(() =>
        (handler as (p: unknown) => unknown)(params)
      );
      return capToolResult(result, toolName);
    };
    const nextArgs = [...args.slice(0, -1), wrapped];
    return (original as (...a: unknown[]) => unknown)(...nextArgs);
  };
}

/**
 * Every group of tools, and what registers it.
 *
 * A group is the unit a deployment can choose to publish. The map is the only
 * list: `registerAllTools` iterates it rather than naming the registrars
 * again, so a group cannot be defined here and forgotten at the call site,
 * and `tests/tool-groups.test.ts` asserts every registered tool belongs to
 * exactly one group -- a tool that escaped grouping would be unswitchable,
 * and nobody would notice until it was published somewhere it should not be.
 */
export const TOOL_GROUPS = {
  search: registerSearchTools,
  pathway: registerPathwayTools,
  entity: registerEntityTools,
  analysis: registerAnalysisTools,
  export: registerExportTools,
  interactors: registerInteractorTools,
  gsa: registerGsaTools,
  utilities: registerUtilityTools,
} as const satisfies Record<string, (server: McpServer) => void>;

export type ToolGroup = keyof typeof TOOL_GROUPS;

export const ALL_TOOL_GROUPS = Object.keys(TOOL_GROUPS) as ToolGroup[];

/**
 * Which groups of tools this instance registers, from `MCP_TOOL_GROUPS`.
 *
 * Unset registers everything, so a local stdio user is unaffected. A public
 * deployment names the groups it means to publish.
 *
 * **This is a registration switch, not a documentation one.** A tool that is
 * described nowhere but still answers is exactly the divergence that cost
 * this repo a public Cypher surface and a server advertising tools it had not
 * registered: what a server *offers* must be the same fact as what it *says*,
 * and the only way to be sure is for the unwanted tool not to exist on the
 * instance.
 *
 * **Three cases, deliberately different**, because the dangerous failure is a
 * restriction that silently becomes "everything":
 *
 *     unset            -> all groups (the local default)
 *     set and empty    -> throws
 *     set with a typo  -> throws
 *
 * An unparseable restriction must never fall back to publishing more than was
 * asked for. Failing to start is recoverable and loud; quietly serving the
 * full surface on a public endpoint is neither.
 *
 * The environment is read here rather than captured in config.ts, so there is
 * one copy of the value and it can be exercised directly.
 */
export function resolveToolGroups(
  raw: string | undefined = process.env.MCP_TOOL_GROUPS
): ToolGroup[] {
  if (raw === undefined) return ALL_TOOL_GROUPS;

  const requested = raw
    .split(",")
    .map(name => name.trim().toLowerCase())
    .filter(name => name.length > 0);

  if (requested.length === 0) {
    throw new Error(
      `MCP_TOOL_GROUPS is set but names no group. Unset it to register everything, ` +
        `or name groups: ${ALL_TOOL_GROUPS.join(", ")}.`
    );
  }

  const unknown = requested.filter(name => !(name in TOOL_GROUPS));
  if (unknown.length > 0) {
    throw new Error(
      `MCP_TOOL_GROUPS names unknown group(s): ${unknown.join(", ")}. ` +
        `Known groups: ${ALL_TOOL_GROUPS.join(", ")}.`
    );
  }

  // Deduplicated, and in the map's order rather than the caller's, so the
  // registration order does not depend on how the variable was written.
  return ALL_TOOL_GROUPS.filter(name => requested.includes(name));
}

export function registerAllTools(server: McpServer, groups: ToolGroup[] = resolveToolGroups()) {
  installToolWrapper(server);

  // No graph database tools. They were removed on 2026-09-21 when this
  // server became publicly hosted: Constitution Principle IV already said no
  // deployment holds a Neo4j connection, and a gate enforcing that is a gate
  // somebody can flip. Nothing here opens one now.

  for (const group of groups) TOOL_GROUPS[group](server);

  if (groups.length < ALL_TOOL_GROUPS.length) {
    const omitted = ALL_TOOL_GROUPS.filter(g => !groups.includes(g));
    logger.info("registering a subset of tool groups", {
      registered: groups,
      omitted,
      source: "MCP_TOOL_GROUPS",
    });
  }
}

/**
 * Describe a database object that is too large to return, so the caller can ask
 * again for the part it wants via `reactome_query`'s `attribute` argument.
 */
function summariseLargeObject(
  id: string,
  result: Record<string, unknown>,
  totalChars: number
): string {
  const describe = (value: unknown): string => {
    if (Array.isArray(value)) return `array of ${value.length}`;
    if (value === null) return "null";
    if (typeof value === "object") return "object";
    // Not String(value): these come off an untyped JSON object, and String()
    // on one renders "[object Object]" -- the same quiet wrongness this repo
    // has shipped before.
    const text = JSON.stringify(value) ?? typeof value;
    return text.length > 60 ? `${typeof value}, ${text.length} chars` : text;
  };

  const entries = Object.entries(result)
    .map(([key, value]) => [key, describe(value), JSON.stringify(value)?.length ?? 0] as const)
    .sort((a, b) => b[2] - a[2]);

  return [
    `## ${typeof result.displayName === "string" ? result.displayName : id}`,
    "",
    `This object is ${totalChars.toLocaleString()} characters — too large to return whole ` +
      `(limit ${MAX_TOOL_RESPONSE_CHARS.toLocaleString()}). Its fields are listed below.`,
    "",
    `**Ask for one field** with \`reactome_query\` and the \`attribute\` argument, ` +
      `e.g. \`{ id: "${id}", attribute: "${entries[0]?.[0] ?? "displayName"}" }\`.`,
    "",
    "| field | contents | size |",
    "| --- | --- | ---: |",
    ...entries.map(([key, shape, size]) => `| \`${key}\` | ${shape} | ${size.toLocaleString()} |`),
  ].join("\n");
}

function registerUtilityTools(server: McpServer) {
  // Get species list
  server.tool(
    "reactome_species",
    "Get the list of species available in Reactome.",
    {
      main_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("Only return main species with curated pathways"),
    },
    async ({ main_only }) => {
      const endpoint = main_only ? "/data/species/main" : "/data/species/all";
      const species = await contentClient.get<Species[]>(endpoint);

      const lines = [
        `## Reactome Species`,
        `**Total:** ${species.length}`,
        main_only ? "(main species with curated/inferred pathways)" : "(all species)",
        "",
        "| Name | Taxonomy ID | Short Name |",
        "|------|-------------|------------|",
        ...species
          .slice(0, 50)
          .map(s => `| ${s.displayName} | ${s.taxId} | ${s.shortName || "-"} |`),
      ];

      if (species.length > 50) {
        lines.push(`... and ${species.length - 50} more species`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get diseases
  server.tool(
    "reactome_diseases",
    "Get the list of diseases annotated in Reactome.",
    {},
    async () => {
      const diseases = await contentClient.get<Disease[]>("/data/diseases");

      const lines = [
        `## Reactome Diseases`,
        `**Total:** ${diseases.length}`,
        "",
        ...diseases
          .slice(0, 50)
          .map(
            d =>
              `- **${d.displayName}**${d.identifier ? ` (${d.databaseName}:${d.identifier})` : ""}`
          ),
      ];

      if (diseases.length > 50) {
        lines.push(`... and ${diseases.length - 50} more diseases`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get database info
  server.tool(
    "reactome_database_info",
    "Get Reactome database version and name information.",
    {},
    async () => {
      const [name, version] = await Promise.all([
        contentClient.getText("/data/database/name"),
        contentClient.getText("/data/database/version"),
      ]);

      const lines = [
        `## Reactome Database Info`,
        `**Database:** ${name.trim()}`,
        `**Version:** ${version.trim()}`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Map identifier to pathways
  server.tool(
    "reactome_mapping_pathways",
    "Map an external identifier to Reactome pathways.",
    {
      resource: nonEmptyString.describe(
        "Database name (e.g., 'UniProt', 'NCBI', 'Ensembl', 'ChEBI')"
      ),
      identifier: nonEmptyString.describe("External identifier"),
    },
    async ({ resource, identifier }) => {
      const pathways = await contentClient.get<Pathway[]>(
        `/data/mapping/${encodeURIComponent(resource)}/${encodeURIComponent(identifier)}/pathways`
      );

      const lines = [
        `## Pathways for ${resource}:${identifier}`,
        `**Found:** ${pathways.length} pathways`,
        "",
        ...pathways
          .slice(0, 50)
          .map(p => `- **${p.displayName}** (${p.stId}) - ${p.speciesName || "Unknown species"}`),
      ];

      if (pathways.length > 50) {
        lines.push(`... and ${pathways.length - 50} more pathways`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Map identifier to reactions
  server.tool(
    "reactome_mapping_reactions",
    "Map an external identifier to Reactome reactions.",
    {
      resource: nonEmptyString.describe(
        "Database name (e.g., 'UniProt', 'NCBI', 'Ensembl', 'ChEBI')"
      ),
      identifier: nonEmptyString.describe("External identifier"),
    },
    async ({ resource, identifier }) => {
      interface Reaction {
        dbId: number;
        stId: string;
        displayName: string;
        speciesName?: string;
      }

      const reactions = await contentClient.get<Reaction[]>(
        `/data/mapping/${encodeURIComponent(resource)}/${encodeURIComponent(identifier)}/reactions`
      );

      const lines = [
        `## Reactions for ${resource}:${identifier}`,
        `**Found:** ${reactions.length} reactions`,
        "",
        ...reactions.slice(0, 50).map(r => `- **${r.displayName}** (${r.stId})`),
      ];

      if (reactions.length > 50) {
        lines.push(`... and ${reactions.length - 50} more reactions`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get orthology
  server.tool(
    "reactome_orthology",
    "Get orthologous events or entities in a different species.",
    {
      id: nonEmptyString.describe("Reactome stable ID of an event or entity"),
      species: nonEmptyString.describe("Target species (taxonomy ID or name)"),
    },
    async ({ id, species }) => {
      interface OrthologyResult {
        dbId: number;
        stId: string;
        displayName: string;
        speciesName: string;
      }

      const result = await contentClient.get<OrthologyResult[]>(
        `/data/orthology/${encodeURIComponent(id)}/species/${encodeURIComponent(species)}`
      );

      const lines = [
        `## Orthology for ${id} in ${species}`,
        `**Found:** ${result.length} orthologous entries`,
        "",
        ...result.map(o => `- **${o.displayName}** (${o.stId}) - ${o.speciesName}`),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Query any Reactome object
  server.tool(
    "reactome_query",
    "Query any Reactome database object by its identifier. Returns detailed information about the object.",
    {
      id: nonEmptyString.describe("Reactome stable ID or database ID"),
      attribute: nonEmptyString.optional().describe("Specific attribute to retrieve (optional)"),
    },
    async ({ id, attribute }) => {
      // A single attribute comes back as text/plain, not JSON. Asking for it
      // with Accept: application/json is answered with HTTP 406, so this
      // argument had never worked -- every attribute request failed.
      if (attribute) {
        const value = await contentClient.getText(
          `/data/query/${encodeURIComponent(id)}/${encodeURIComponent(attribute)}`
        );
        return {
          content: [{ type: "text", text: `**${attribute}** of ${id}:\n\n${value}` }],
        };
      }

      const result = await contentClient.get<Record<string, unknown>>(
        `/data/query/enhanced/${encodeURIComponent(id)}`
      );

      // Compact, not indented. This endpoint returns whole database objects --
      // Metabolism is ~48 KB pretty-printed. Dropping the indentation saves
      // ~23%, and a model does not need the whitespace.
      const json = JSON.stringify(result);
      if (json.length <= MAX_TOOL_RESPONSE_CHARS) {
        return { content: [{ type: "text", text: json }] };
      }

      // Too big to return whole. Truncating would hand back invalid JSON and
      // still spend the whole budget, so describe the object's shape instead
      // and point at the `attribute` argument this tool already accepts. A map
      // of what is available is worth more than 40 KB of a severed object.
      return {
        content: [{ type: "text", text: summariseLargeObject(id, result, json.length) }],
      };
    }
  );
}
