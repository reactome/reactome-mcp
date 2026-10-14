import { z } from "zod";
import type { GraphSchema } from "./schema.js";

/**
 * Which database a schema describes, and how to tell whether a schema saved
 * to a file still describes the database the server is pointed at.
 *
 * A saved schema (`reactome-mcp extract-schema`, served through
 * `NEO4J_SCHEMA_FILE`) is a description of one database. Served against
 * another, it would be read as a description of that one -- labels that are
 * not there, counts that are wrong -- which is a confident wrong answer, the
 * failure this server is built to avoid. So every schema carries a
 * fingerprint, and a saved one is served only when the live database gives
 * the same fingerprint back.
 *
 * The fingerprint is the cheap part of the schema: version, release and two
 * totals, each answered without scanning (the totals come from the count
 * store). It is not proof of identity -- two databases could agree on all of
 * it -- but a different release, or a database that has gained or lost a
 * single node or relationship since the file was written, does not match.
 */

/**
 * The layout of the schema JSON. Bump it whenever a field is added, removed or
 * changes meaning, so a server never reads a file written for another layout
 * as if it were its own.
 */
export const SCHEMA_FORMAT = 1;

export interface SchemaSource {
  /** First component reported by `dbms.components()`. */
  neo4jVersion: string | null;
  neo4jEdition: string | null;
  /**
   * `releaseNumber` of the graph's DBInfo node. Absent, not null, on a
   * database without one -- a curator database, or not Reactome's.
   */
  releaseNumber?: number | string;
  nodeCount: number;
  relCount: number;
  /** When this fingerprint was read. Not compared. */
  generatedAt: string;
}

/** The fields compared, in the order a mismatch is reported. */
const COMPARED = [
  "neo4jVersion",
  "neo4jEdition",
  "releaseNumber",
  "nodeCount",
  "relCount",
] as const;

const show = (value: unknown) => (value === undefined ? "(none)" : JSON.stringify(value));

/**
 * What differs between the fingerprint a file was saved with and the live
 * database's, as `field: file X, database Y`. Empty means they match.
 */
export function sourceMismatches(file: SchemaSource, live: SchemaSource): string[] {
  const out: string[] = [];
  for (const field of COMPARED) {
    const a = file[field];
    const b = live[field];
    // A release stored as 97 and read back as "97" is the same release.
    const same = a === undefined || b === undefined ? a === b : String(a) === String(b);
    if (!same) out.push(`${field}: file ${show(a)}, database ${show(b)}`);
  }
  return out;
}

const names = z.array(z.string()).nullable().optional();

const sourceSchema = z.object({
  neo4jVersion: z.string().nullable(),
  neo4jEdition: z.string().nullable(),
  releaseNumber: z.union([z.number(), z.string()]).optional(),
  nodeCount: z.number(),
  relCount: z.number(),
  generatedAt: z.string(),
});

const graphSchemaSchema = z.object({
  schemaFormat: z.number(),
  fetchedAt: z.string(),
  source: sourceSchema,
  dbComponents: z.array(
    z.object({ name: z.string(), versions: z.array(z.string()), edition: z.string() })
  ),
  stats: z.object({
    nodeCount: z.number(),
    relCount: z.number(),
    labels: z.record(z.string(), z.number()),
    relTypesCount: z.record(z.string(), z.number()),
  }),
  patterns: z.array(z.object({ start: z.string(), type: z.string(), end: z.string() })),
  nodeTypeProperties: z.array(
    z.object({
      nodeType: z.string(),
      nodeLabels: z.array(z.string()),
      propertyName: z.string(),
      propertyTypes: z.array(z.string()),
      mandatory: z.boolean(),
    })
  ),
  relTypeProperties: z.array(
    z.object({
      relType: z.string(),
      propertyName: z.string(),
      propertyTypes: z.array(z.string()),
      mandatory: z.boolean(),
    })
  ),
  indexes: z.array(
    z.object({
      name: z.string().optional(),
      type: z.string().optional(),
      entityType: z.string().optional(),
      labelsOrTypes: names,
      properties: names,
      state: z.string().optional(),
    })
  ),
  constraints: z.array(
    z.object({
      name: z.string().optional(),
      type: z.string().optional(),
      entityType: z.string().optional(),
      labelsOrTypes: names,
      properties: names,
      description: z.string().optional(),
    })
  ),
  unavailable: z.array(z.object({ section: z.string(), reason: z.string() })),
});

/**
 * Read a saved schema, or throw saying why it cannot be used: not JSON,
 * another format, no fingerprint, a missing or mistyped section, or sections
 * that were unavailable when it was saved (a saved schema is served for as
 * long as the database matches, so a gap in it would never be filled).
 *
 * Checked field by field rather than cast, because a cast would let a
 * truncated or hand-edited file through as a schema.
 */
export function parseSchemaSnapshot(text: string): GraphSchema & { source: SchemaSource } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON (${error instanceof Error ? error.message : String(error)})`, {
      cause: error,
    });
  }

  const format = (raw as { schemaFormat?: unknown } | null)?.schemaFormat;
  if (format !== SCHEMA_FORMAT) {
    throw new Error(`schemaFormat is ${show(format)}; this server reads ${SCHEMA_FORMAT}`);
  }

  const parsed = graphSchemaSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues
      .slice(0, 3)
      .map(i => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`not a schema this server can read (${where})`);
  }

  const schema = parsed.data;
  if (schema.unavailable.length > 0) {
    throw new Error(
      `saved with unavailable sections (${schema.unavailable.map(u => u.section).join(", ")})`
    );
  }
  return schema;
}
