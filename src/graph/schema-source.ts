import { createHash } from "node:crypto";
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
 * The fingerprint is the cheap part of the schema -- metadata reads and
 * count-store lookups, nothing that scans nodes or their properties:
 *
 *   the Neo4j version and edition, and the name of the database connected to
 *   the release in the DBInfo node, where there is one
 *   total node and relationship counts
 *   digests of the label, relationship type and property key lists, and of
 *   the indexes (name, labels, properties, state) and constraints
 *
 * So a different release or database, a node or relationship added or
 * removed, a new label, type or property key (`SET n.newProp`), and an index
 * or constraint created, dropped or no longer online all fail to match.
 *
 * What it does **not** see, because seeing it would mean reading the data:
 * a change that keeps every total and every list as it was -- a property's
 * value changing, or its type (a string becoming a list), or an existing key
 * being set on nodes that lacked it, or one node deleted and another added
 * with the same labels. Property keys are tokens that Neo4j keeps once
 * created, so a key no longer used anywhere still counts as present. It is a
 * fingerprint, not proof of identity.
 */

/**
 * The layout of the schema JSON. Bump it whenever a field is added, removed or
 * changes meaning, so a server never reads a file written for another layout
 * as if it were its own.
 */
export const SCHEMA_FORMAT = 2;

export interface SchemaSource {
  /** First component reported by `dbms.components()`. */
  neo4jVersion: string | null;
  neo4jEdition: string | null;
  /** The database actually connected to (`db.info()`), not the one asked for. */
  database: string | null;
  /**
   * `releaseNumber` of the graph's DBInfo node. Absent, not null, on a
   * database without one -- a curator database, or not Reactome's.
   */
  releaseNumber?: number | string;
  nodeCount: number;
  relCount: number;
  /** sha256 of each list in canonical order; see `digestNames` and friends. */
  labelsDigest: string;
  relationshipTypesDigest: string;
  propertyKeysDigest: string;
  indexesDigest: string;
  constraintsDigest: string;
  /** When this fingerprint was read. Not compared. */
  generatedAt: string;
}

/** The fields compared, in the order a mismatch is reported. */
const COMPARED = [
  "neo4jVersion",
  "neo4jEdition",
  "database",
  "releaseNumber",
  "nodeCount",
  "relCount",
  "labelsDigest",
  "relationshipTypesDigest",
  "propertyKeysDigest",
  "indexesDigest",
  "constraintsDigest",
] as const;

const show = (value: unknown) => (value === undefined ? "(none)" : JSON.stringify(value));

const sha256 = (keys: string[]) =>
  createHash("sha256")
    .update(JSON.stringify([...new Set(keys)].sort()))
    .digest("hex");

/** A list of names, whatever order the database gives them in. */
export const digestNames = (names: string[]) => sha256(names);

/** Indexes by what a query planner cares about: name, target, and whether it is usable. */
export const digestIndexes = (indexes: GraphSchema["indexes"]) =>
  sha256(
    indexes.map(i =>
      JSON.stringify([
        i.name ?? null,
        i.labelsOrTypes ?? null,
        i.properties ?? null,
        i.state ?? null,
      ])
    )
  );

/** Constraints by name and target, or by description where only db.constraints() answered. */
export const digestConstraints = (constraints: GraphSchema["constraints"]) =>
  sha256(
    constraints.map(c =>
      JSON.stringify([
        c.name ?? null,
        c.labelsOrTypes ?? null,
        c.properties ?? null,
        c.description ?? null,
      ])
    )
  );

/** Digests read as their first twelve characters; the rest says nothing more to a reader. */
const showField = (_field: string, value: unknown) =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value.slice(0, 12) : show(value);

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
    if (!same) {
      const name = field.replace(/Digest$/, "");
      out.push(`${name}: file ${showField(field, a)}, database ${showField(field, b)}`);
    }
  }
  return out;
}

const names = z.array(z.string()).nullable().optional();

const digest = z.string().regex(/^[0-9a-f]{64}$/);

const sourceSchema = z.object({
  database: z.string().nullable(),
  labelsDigest: digest,
  relationshipTypesDigest: digest,
  propertyKeysDigest: digest,
  indexesDigest: digest,
  constraintsDigest: digest,
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
  const inconsistent = schemaInconsistencies(schema);
  if (inconsistent.length > 0) {
    throw new Error(`its body disagrees with its own fingerprint (${inconsistent.join("; ")})`);
  }
  return schema;
}

/**
 * Where a schema's body disagrees with its own `source` fingerprint, as
 * `field: body X, source Y`. Empty when consistent.
 *
 * The two are read by separate queries, so a database written to during an
 * extraction gives a schema that matches neither the before nor the after;
 * and a hand-edited file can change one without the other. Either way the
 * fingerprint would vouch for a body it does not describe. Property keys and
 * the database name have nothing in the body to check against.
 */
export function schemaInconsistencies(schema: GraphSchema & { source: SchemaSource }): string[] {
  const { source, stats } = schema;
  const out: string[] = [];
  const check = (field: string, body: unknown, fingerprint: unknown) => {
    if (body !== fingerprint) {
      out.push(`${field}: body ${showField(field, body)}, source ${showField(field, fingerprint)}`);
    }
  };
  check("nodeCount", stats.nodeCount, source.nodeCount);
  check("relCount", stats.relCount, source.relCount);
  check("labels", digestNames(Object.keys(stats.labels)), source.labelsDigest);
  check(
    "relationshipTypes",
    digestNames(Object.keys(stats.relTypesCount)),
    source.relationshipTypesDigest
  );
  check("indexes", digestIndexes(schema.indexes), source.indexesDigest);
  check("constraints", digestConstraints(schema.constraints), source.constraintsDigest);
  check("neo4jVersion", schema.dbComponents[0]?.versions[0] ?? null, source.neo4jVersion);
  check("neo4jEdition", schema.dbComponents[0]?.edition ?? null, source.neo4jEdition);
  return out;
}
