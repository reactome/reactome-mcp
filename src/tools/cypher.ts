import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRead, fetchGraphSchema } from "../clients/neo4j.js";
import { logger } from "../logger.js";
import { rejectWriteThroughCalls } from "./cypher-guard.js";

const MAX_QUERY_CHARS = 50_000;
const MAX_ROWS_DEFAULT = 100;
const MAX_ROWS_CAP = 1000;
const MAX_ROW_CHARS_DEFAULT = 2000;
const MAX_ROW_CHARS_CAP = 20000;
const MAX_TOTAL_CHARS_DEFAULT = 40000;
const MAX_TOTAL_CHARS_CAP = 200000;

interface RowSummary {
  __truncated: true;
  reason: "row_too_large";
  keys: string[];
  original_chars: number;
}

function summarizeRow(row: Record<string, unknown>, json: string): RowSummary {
  return {
    __truncated: true,
    reason: "row_too_large",
    keys: Object.keys(row),
    original_chars: json.length,
  };
}

export interface CapRowsStats {
  rowCountTruncated: boolean;
  rowsWidthTruncated: number;
  stoppedAtTotal: boolean;
}

export function capCypherRows(
  rows: Record<string, unknown>[],
  maxRows: number,
  maxRowChars: number,
  maxTotalChars: number
): { output: unknown[]; stats: CapRowsStats } {
  const rowCountTruncated = rows.length > maxRows;
  const limitedRows = rowCountTruncated ? rows.slice(0, maxRows) : rows;

  const output: unknown[] = [];
  let totalChars = 0;
  let rowsWidthTruncated = 0;
  let stoppedAtTotal = false;

  for (const row of limitedRows) {
    const raw = JSON.stringify(row);
    const entry: unknown = raw.length > maxRowChars ? summarizeRow(row, raw) : row;
    const entryChars = JSON.stringify(entry).length;
    if (totalChars + entryChars > maxTotalChars) {
      stoppedAtTotal = true;
      break;
    }
    if (entry !== row) rowsWidthTruncated++;
    output.push(entry);
    totalChars += entryChars;
  }

  return {
    output,
    stats: { rowCountTruncated, rowsWidthTruncated, stoppedAtTotal },
  };
}

export function registerCypherTools(server: McpServer) {
  server.tool(
    "reactome_cypher_query",
    "Run a Cypher query against the local Reactome Neo4j graph database. The session runs in READ mode, which rejects native write clauses (CREATE/MERGE/DELETE/SET/REMOVE). APOC procedures that can write through that guardrail (apoc.cypher.runWrite, apoc.periodic.*, apoc.create/merge/refactor.*, apoc.load/import/export.*, apoc.trigger.*, apoc.nodes.delete) are rejected before execution. Row count, per-row size, and total response size are capped; a query timeout terminates runaway queries. Use LIMIT and project specific fields in your query for large results.",
    {
      query: z
        .string()
        .min(1)
        .max(MAX_QUERY_CHARS)
        .describe(`Cypher query to execute (read-only; max ${MAX_QUERY_CHARS} chars)`),
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
      max_row_chars: z
        .number()
        .int()
        .positive()
        .max(MAX_ROW_CHARS_CAP)
        .optional()
        .default(MAX_ROW_CHARS_DEFAULT)
        .describe(`Maximum JSON chars per row before replacing with a summary (default ${MAX_ROW_CHARS_DEFAULT}, cap ${MAX_ROW_CHARS_CAP})`),
      max_total_chars: z
        .number()
        .int()
        .positive()
        .max(MAX_TOTAL_CHARS_CAP)
        .optional()
        .default(MAX_TOTAL_CHARS_DEFAULT)
        .describe(`Maximum total JSON chars across all rows before truncation (default ${MAX_TOTAL_CHARS_DEFAULT}, cap ${MAX_TOTAL_CHARS_CAP})`),
    },
    async ({ query, params, max_rows, max_row_chars, max_total_chars }) => {
      rejectWriteThroughCalls(query);
      logger.info("cypher_query", { chars: query.length, max_rows });
      const rows = await runRead<Record<string, unknown>>(query, params ?? {});
      const { output, stats } = capCypherRows(rows, max_rows, max_row_chars, max_total_chars);

      const notes: string[] = [];
      notes.push(`**Rows returned:** ${output.length} of ${rows.length}`);
      if (stats.rowCountTruncated) notes.push(`(row-count cap: ${max_rows})`);
      if (stats.rowsWidthTruncated > 0) notes.push(`**Wide rows summarized:** ${stats.rowsWidthTruncated}`);
      if (stats.stoppedAtTotal) notes.push(`**Total size cap reached (${max_total_chars} chars); later rows omitted.**`);

      const body = [
        `## Cypher Result`,
        ...notes,
        "",
        "```json",
        JSON.stringify(output, null, 2),
        "```",
      ];

      return {
        content: [{ type: "text", text: body.join("\n") }],
      };
    }
  );

  server.tool(
    "reactome_cypher_schema",
    "Introspect the Reactome graph schema — node labels, relationship types, and per-label property keys. Use this first to plan queries.",
    {},
    async () => {
      logger.info("cypher_schema");
      const schema = await fetchGraphSchema();

      const lines: string[] = [
        `## Reactome Graph Schema`,
        "",
        `### Labels (${schema.labels.length})`,
        ...schema.labels.map((l) => `- \`${l}\``),
        "",
        `### Relationship Types (${schema.relationshipTypes.length})`,
        ...schema.relationshipTypes.map((r) => `- \`${r}\``),
        "",
        `### Properties by Label`,
      ];

      const sortedKeys = Object.keys(schema.propertiesByLabel).sort();
      for (const key of sortedKeys) {
        lines.push(`- **${key}**`);
        for (const p of schema.propertiesByLabel[key]) {
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
      label: z.string().min(1).max(200).describe("Node label to sample (e.g. 'Pathway', 'ReactionLikeEvent', 'PhysicalEntity')"),
      limit: z.number().int().positive().max(50).optional().default(5).describe("Number of nodes to return (default 5, max 50)"),
    },
    async ({ label, limit }) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
        throw new Error(`Invalid label: ${label}`);
      }
      logger.info("cypher_sample", { label, limit });
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
