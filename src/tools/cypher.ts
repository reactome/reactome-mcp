import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runRead, runReadLimited } from "../clients/neo4j.js";
import { fetchGraphSchema } from "../graph/schema.js";
import { formatGraphSchemaMarkdown } from "../graph/format-schema.js";
import { logger } from "../logger.js";
import { assertReadOnlyQuery } from "./cypher-guard.js";
import { isGraphAccessEnabled } from "../graph/gate.js";

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

/**
 * The `cypher` tool group.
 *
 * Registers nothing unless the graph access gate is open -- checked here as
 * well as by the caller, so a path that reaches this registrar without going
 * through `resolveToolGroups()` still cannot publish these tools.
 */
export function registerCypherTools(server: McpServer) {
  if (!isGraphAccessEnabled()) return;

  server.tool(
    "reactome_cypher_query",
    "Run a read-only Cypher query against the Reactome graph database (Neo4j). Call reactome_cypher_schema first; never guess labels or properties. The session runs in READ mode, which rejects CREATE/MERGE/DELETE/SET/REMOVE. CALL is allowed only for the built-in schema procedures (db.labels, db.relationshipTypes, db.propertyKeys, db.schema.*, db.indexes, db.constraints, dbms.components) and the fulltext query procedures (db.index.fulltext.queryNodes, db.index.fulltext.queryRelationships). Rejected before execution: every other procedure (creating or dropping a fulltext index included), CALL subqueries (CALL { ... }), APOC and GDS, LOAD CSV, USE, SHOW other than indexes/constraints, and write or admin clauses. The CYPHER options prefix (version, planner, runtime) is refused. SET, SHOW and CYPHER cannot be used as variable names. A server-side timeout terminates long queries. Rows are streamed and reading stops at max_rows; per-row size and total response size are also capped, so always include a LIMIT and return specific properties (RETURN p.stId, p.displayName) rather than whole nodes.",
    {
      query: z
        .string()
        .min(1)
        .max(MAX_QUERY_CHARS)
        .describe(`Cypher query to execute (read-only; max ${MAX_QUERY_CHARS} chars)`),
      params: z
        .record(z.string(), z.unknown())
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
        .describe(
          `Maximum JSON chars per row before replacing with a summary (default ${MAX_ROW_CHARS_DEFAULT}, cap ${MAX_ROW_CHARS_CAP})`
        ),
      max_total_chars: z
        .number()
        .int()
        .positive()
        .max(MAX_TOTAL_CHARS_CAP)
        .optional()
        .default(MAX_TOTAL_CHARS_DEFAULT)
        .describe(
          `Maximum total JSON chars across all rows before truncation (default ${MAX_TOTAL_CHARS_DEFAULT}, cap ${MAX_TOTAL_CHARS_CAP})`
        ),
    },
    async ({ query, params, max_rows, max_row_chars, max_total_chars }) => {
      assertReadOnlyQuery(query);
      logger.info("cypher_query", { chars: query.length, max_rows });
      // Streamed and cut off at max_rows + 1 -- the cap is applied while
      // reading, not after the whole result has been pulled into memory.
      const { rows, more } = await runReadLimited<Record<string, unknown>>(
        query,
        params ?? {},
        max_rows
      );
      const { output, stats } = capCypherRows(rows, max_rows, max_row_chars, max_total_chars);

      const notes: string[] = [];
      notes.push(`**Rows returned:** ${output.length}`);
      if (more) {
        notes.push(
          `(more rows exist; reading stopped at the max_rows cap of ${max_rows} -- add a LIMIT, ORDER BY or a narrower MATCH)`
        );
      }
      if (stats.rowsWidthTruncated > 0)
        notes.push(`**Wide rows summarized:** ${stats.rowsWidthTruncated}`);
      if (stats.stoppedAtTotal)
        notes.push(`**Total size cap reached (${max_total_chars} chars); later rows omitted.**`);

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
    "Introspect the Reactome graph schema: labels and relationship types with counts, which labels each relationship type connects, property names and types with mandatory flags, indexes and constraints. Read live from Neo4j's built-in schema procedures and cached for the life of the server (the server warms it at startup; a cold first call can take tens of seconds). Call this before writing Cypher. Sections the database could not provide are listed as unavailable rather than shown empty. For the full JSON, read the `reactome://graph/schema` resource.",
    {},
    async () => {
      logger.info("cypher_schema");
      const schema = await fetchGraphSchema();
      return {
        content: [{ type: "text", text: formatGraphSchemaMarkdown(schema) }],
      };
    }
  );

  server.tool(
    "reactome_cypher_sample",
    "Return a small sample of nodes for a given label, to inspect shape and typical property values.",
    {
      label: z
        .string()
        .min(1)
        .max(200)
        .describe("Node label to sample (e.g. 'Pathway', 'ReactionLikeEvent', 'PhysicalEntity')"),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .default(5)
        .describe("Number of nodes to return (default 5, max 50)"),
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
        JSON.stringify(
          rows.map(r => r.n),
          null,
          2
        ),
        "```",
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
