import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRead } from "../clients/neo4j.js";

const MAX_ROWS_DEFAULT = 100;
const MAX_ROWS_CAP = 1000;

export function registerCypherTools(server: McpServer) {
  server.tool(
    "reactome_cypher_query",
    "Run a read-only Cypher query against the local Reactome Neo4j graph database. The session is opened in READ mode — write clauses (CREATE/MERGE/DELETE/SET) will be rejected by the server. Results are capped; use LIMIT in your query for large result sets.",
    {
      query: z.string().describe("Cypher query to execute (read-only)"),
      params: z
        .record(z.unknown())
        .optional()
        .describe("Optional parameter map passed to the query"),
      max_rows: z
        .number()
        .int()
        .positive()
        .max(MAX_ROWS_CAP)
        .optional()
        .default(MAX_ROWS_DEFAULT)
        .describe(`Maximum rows to return (default ${MAX_ROWS_DEFAULT}, cap ${MAX_ROWS_CAP})`),
    },
    async ({ query, params, max_rows }) => {
      const rows = await runRead(query, params ?? {});
      const truncated = rows.length > max_rows;
      const shown = truncated ? rows.slice(0, max_rows) : rows;

      const header = [
        `## Cypher Result`,
        `**Rows:** ${rows.length}${truncated ? ` (showing first ${max_rows})` : ""}`,
        "",
        "```json",
        JSON.stringify(shown, null, 2),
        "```",
      ];

      return {
        content: [{ type: "text", text: header.join("\n") }],
      };
    }
  );

  server.tool(
    "reactome_cypher_schema",
    "Introspect the Reactome graph schema — node labels, relationship types, and per-label property keys. Use this first to plan queries.",
    {},
    async () => {
      interface LabelRow { label: string }
      interface RelRow { relationshipType: string }
      interface PropRow { nodeType: string; propertyName: string; propertyTypes: string[] | null }

      const [labels, rels, props] = await Promise.all([
        runRead<LabelRow>("CALL db.labels() YIELD label RETURN label ORDER BY label"),
        runRead<RelRow>("CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType"),
        runRead<PropRow>("CALL db.schema.nodeTypeProperties() YIELD nodeType, propertyName, propertyTypes RETURN nodeType, propertyName, propertyTypes"),
      ]);

      const propsByLabel = new Map<string, { name: string; types: string[] }[]>();
      for (const p of props) {
        const entry = propsByLabel.get(p.nodeType) ?? [];
        entry.push({ name: p.propertyName, types: p.propertyTypes ?? [] });
        propsByLabel.set(p.nodeType, entry);
      }

      const lines: string[] = [
        `## Reactome Graph Schema`,
        "",
        `### Labels (${labels.length})`,
        ...labels.map((l) => `- \`${l.label}\``),
        "",
        `### Relationship Types (${rels.length})`,
        ...rels.map((r) => `- \`${r.relationshipType}\``),
        "",
        `### Properties by Label`,
      ];

      const sortedKeys = Array.from(propsByLabel.keys()).sort();
      for (const key of sortedKeys) {
        lines.push(`- **${key}**`);
        for (const p of propsByLabel.get(key)!) {
          const typeStr = p.types.length ? ` _(${p.types.join("|")})_` : "";
          lines.push(`  - \`${p.name}\`${typeStr}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  server.tool(
    "reactome_cypher_sample",
    "Return a small sample of nodes for a given label, to inspect shape and typical property values.",
    {
      label: z.string().describe("Node label to sample (e.g. 'Pathway', 'ReactionLikeEvent', 'PhysicalEntity')"),
      limit: z.number().int().positive().max(50).optional().default(5).describe("Number of nodes to return (default 5, max 50)"),
    },
    async ({ label, limit }) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
        throw new Error(`Invalid label: ${label}`);
      }
      const rows = await runRead<{ n: Record<string, unknown> }>(
        `MATCH (n:\`${label}\`) RETURN n LIMIT $limit`,
        { limit }
      );

      const lines = [
        `## Sample of \`${label}\` (${rows.length})`,
        "",
        "```json",
        JSON.stringify(rows.map((r) => r.n), null, 2),
        "```",
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
