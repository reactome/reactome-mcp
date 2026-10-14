import { runRead } from "../clients/neo4j.js";
import { logger } from "../logger.js";

/**
 * The live graph schema, built from Neo4j's **built-in** procedures only.
 *
 * The Reactome graph database container runs Neo4j 4.4 Community with no
 * APOC. The previous version of this file read `apoc.meta.stats()`,
 * `apoc.meta.schema()` and `apoc.meta.nodeTypeProperties()`, and would have
 * failed on its first query there. Everything below exists in 4.4 Community:
 *
 *   dbms.components()              version and edition
 *   db.labels(), db.relationshipTypes()
 *   MATCH (n:`L`) RETURN count(n)  per-token counts, answered from the count
 *                                  store rather than by scanning
 *   db.schema.nodeTypeProperties() property names, types, mandatory flags
 *   db.schema.relTypeProperties()
 *   db.schema.visualization()      which label connects to which, by type
 *   SHOW INDEXES / SHOW CONSTRAINTS, falling back to db.indexes() /
 *                                  db.constraints() where SHOW is not known
 *
 * Each section is fetched on its own and fails on its own. A section that
 * cannot be read is listed in `unavailable` with the reason, rather than
 * rendered empty -- an empty property list reads as "these labels have no
 * properties", which is a confident wrong answer.
 *
 * Row shapes, recorded from the Reactome graph database (Neo4j 4.4.48
 * Community, Release 97), trimmed:
 *   db.schema.nodeTypeProperties  {nodeType: ":`CandidateSet`:`DatabaseObject`:...",
 *                                  nodeLabels: ["CandidateSet", "DatabaseObject", ...],
 *                                  propertyName: "dbId", propertyTypes: ["Long"],
 *                                  mandatory: true}
 *   db.schema.relTypeProperties   {relType: ":`author`", propertyName: "order",
 *                                  propertyTypes: ["Integer", "Long"], mandatory: true}
 *   db.schema.visualization       {nodes: [{identity: -127, labels: ["TopLevelPathway"],
 *                                  properties: {name: "TopLevelPathway", ...}}],
 *                                  relationships: [{identity: -7911, start: -134,
 *                                  end: -179, type: "authored"}]}
 *   SHOW INDEXES                  {name, type: "BTREE", entityType: "NODE",
 *                                  labelsOrTypes: ["DatabaseObject"],
 *                                  properties: ["dbId"], state: "ONLINE"}
 *   SHOW CONSTRAINTS              {name, type: "UNIQUENESS", entityType: "NODE",
 *                                  labelsOrTypes: ["DatabaseObject"], properties: ["dbId"]}
 *
 * On that graph the whole fetch took about 65 s (2.96M nodes, 11.5M
 * relationships, 108 labels, 88 types, 5,669 label-level patterns), almost
 * all of it `db.schema.nodeTypeProperties()`. Hence the warm-up, and the
 * timeout below.
 */
export interface GraphSchema {
  fetchedAt: string;
  dbComponents: Array<{ name: string; versions: string[]; edition: string }>;
  stats: {
    nodeCount: number;
    relCount: number;
    labels: Record<string, number>;
    relTypesCount: Record<string, number>;
  };
  /** Label-level connections: (start)-[type]->(end). */
  patterns: Array<{ start: string; type: string; end: string }>;
  nodeTypeProperties: Array<{
    nodeType: string;
    nodeLabels: string[];
    propertyName: string;
    propertyTypes: string[];
    mandatory: boolean;
  }>;
  relTypeProperties: Array<{
    relType: string;
    propertyName: string;
    propertyTypes: string[];
    mandatory: boolean;
  }>;
  indexes: Array<{
    name?: string;
    type?: string;
    entityType?: string;
    labelsOrTypes?: string[] | null;
    properties?: string[] | null;
    state?: string;
  }>;
  constraints: Array<{
    name?: string;
    type?: string;
    entityType?: string;
    labelsOrTypes?: string[] | null;
    properties?: string[] | null;
    description?: string;
  }>;
  /** Sections that could not be read, and why. Empty when complete. */
  unavailable: Array<{ section: string; reason: string }>;
}

/**
 * Schema queries get a longer budget than an ordinary Cypher query:
 * `db.schema.nodeTypeProperties()` reads every node's property keys on 4.4,
 * which on the Reactome graph is not quick. The warm-up at startup pays it
 * once, so callers do not.
 */
const SCHEMA_FETCH_TIMEOUT_MS = 120_000;

let schemaCache: GraphSchema | null = null;
let schemaPending: Promise<GraphSchema> | null = null;

type Section = keyof Omit<GraphSchema, "fetchedAt" | "unavailable">;

class SectionUnavailable extends Error {}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Run the first of `queries` that works; throw with every failure if none does. */
async function firstThatWorks<T>(queries: string[], params: Record<string, unknown> = {}) {
  const failures: string[] = [];
  for (const query of queries) {
    try {
      return await runRead<T>(query, params, { timeoutMs: SCHEMA_FETCH_TIMEOUT_MS });
    } catch (error) {
      failures.push(message(error));
    }
  }
  throw new SectionUnavailable(failures.join(" | "));
}

/** Backticks, doubled, are how Cypher escapes a backtick inside a quoted name. */
const quoteName = (name: string) => "`" + name.replace(/`/g, "``") + "`";

/** ":`input`" -> "input", as db.schema.relTypeProperties() reports it. */
const bareRelType = (relType: string) =>
  relType
    .replace(/^:/, "")
    .replace(/^`(.*)`$/, "$1")
    .replace(/``/g, "`");

/**
 * One query that counts every token, answered from the count store. Names go
 * in as parameters for the returned key and quoted for the pattern, so a label
 * containing a backtick can neither break nor extend the query.
 */
async function countEach(tokens: string[], pattern: (quoted: string) => string) {
  if (tokens.length === 0) return {};
  const params: Record<string, string> = {};
  const parts = tokens.map((token, i) => {
    params[`k${i}`] = token;
    // The count sits alone in a subquery so the planner can answer it from
    // the count store; with the key projected beside it, it might scan.
    return `CALL { ${pattern(quoteName(token))} } RETURN $k${i} AS key, c AS count`;
  });
  const rows = await firstThatWorks<{ key: string; count: number }>(
    [parts.join(" UNION ALL ")],
    params
  );
  return Object.fromEntries(rows.map(r => [r.key, Number(r.count)]));
}

async function fetchStats(): Promise<GraphSchema["stats"]> {
  const [labelRows, relRows, nodeTotal, relTotal] = await Promise.all([
    firstThatWorks<{ label: string }>(["CALL db.labels() YIELD label RETURN label"]),
    firstThatWorks<{ relationshipType: string }>([
      "CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType",
    ]),
    firstThatWorks<{ count: number }>(["MATCH (n) RETURN count(n) AS count"]),
    firstThatWorks<{ count: number }>(["MATCH ()-[r]->() RETURN count(r) AS count"]),
  ]);
  const [labels, relTypesCount] = await Promise.all([
    countEach(
      labelRows.map(r => r.label),
      q => `MATCH (n:${q}) RETURN count(n) AS c`
    ),
    countEach(
      relRows.map(r => r.relationshipType),
      q => `MATCH ()-[r:${q}]->() RETURN count(r) AS c`
    ),
  ]);
  return {
    nodeCount: Number(nodeTotal[0]?.count ?? 0),
    relCount: Number(relTotal[0]?.count ?? 0),
    labels,
    relTypesCount,
  };
}

interface VizNode {
  identity: unknown;
  labels?: string[];
  properties?: { name?: string };
}
interface VizRel {
  start: unknown;
  end: unknown;
  type: string;
}

async function fetchPatterns(): Promise<GraphSchema["patterns"]> {
  const rows = await firstThatWorks<{ nodes: VizNode[]; relationships: VizRel[] }>([
    "CALL db.schema.visualization() YIELD nodes, relationships RETURN nodes, relationships",
  ]);
  const row = rows[0];
  if (!row) return [];
  const labelOf = new Map<string, string>();
  for (const node of row.nodes ?? []) {
    labelOf.set(String(node.identity), node.labels?.[0] ?? node.properties?.name ?? "?");
  }
  return (row.relationships ?? [])
    .map(rel => ({
      start: labelOf.get(String(rel.start)) ?? "?",
      type: rel.type,
      end: labelOf.get(String(rel.end)) ?? "?",
    }))
    .sort(
      (a, b) =>
        a.type.localeCompare(b.type) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
    );
}

const SECTIONS: { [K in Section]: () => Promise<GraphSchema[K]> } = {
  dbComponents: () =>
    firstThatWorks([
      "CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition",
    ]),
  stats: fetchStats,
  patterns: fetchPatterns,
  nodeTypeProperties: () =>
    firstThatWorks([
      "CALL db.schema.nodeTypeProperties() YIELD nodeType, nodeLabels, propertyName, propertyTypes, mandatory RETURN nodeType, nodeLabels, propertyName, propertyTypes, mandatory",
    ]),
  relTypeProperties: async () => {
    const rows = await firstThatWorks<GraphSchema["relTypeProperties"][number]>([
      "CALL db.schema.relTypeProperties() YIELD relType, propertyName, propertyTypes, mandatory RETURN relType, propertyName, propertyTypes, mandatory",
    ]);
    // A relationship type with no properties at all is reported once with a
    // null propertyName; that is "no properties", not a property.
    return rows
      .filter(r => r.propertyName != null)
      .map(r => ({ ...r, relType: bareRelType(r.relType) }));
  },
  indexes: () =>
    firstThatWorks([
      "SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, state RETURN name, type, entityType, labelsOrTypes, properties, state",
      "CALL db.indexes() YIELD name, type, entityType, labelsOrTypes, properties, state RETURN name, type, entityType, labelsOrTypes, properties, state",
    ]),
  constraints: () =>
    firstThatWorks([
      "SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties RETURN name, type, entityType, labelsOrTypes, properties",
      "CALL db.constraints() YIELD name, description RETURN name, description",
    ]),
};

const EMPTY: Omit<GraphSchema, "fetchedAt" | "unavailable"> = {
  dbComponents: [],
  stats: { nodeCount: 0, relCount: 0, labels: {}, relTypesCount: {} },
  patterns: [],
  nodeTypeProperties: [],
  relTypeProperties: [],
  indexes: [],
  constraints: [],
};

/**
 * Fetch the schema, once. Cached in memory after the first call that reads
 * anything; concurrent first callers share one fetch.
 *
 * A fetch in which **no** section could be read -- the database is down, the
 * credentials are wrong -- throws and is not cached, so the next call tries
 * again instead of serving an empty schema for the life of the process.
 */
export async function fetchGraphSchema(): Promise<GraphSchema> {
  if (schemaCache) return schemaCache;
  if (schemaPending) return schemaPending;

  const start = Date.now();
  schemaPending = (async () => {
    try {
      const names = Object.keys(SECTIONS) as Section[];
      const settled = await Promise.allSettled(names.map(name => SECTIONS[name]()));

      const result: GraphSchema = {
        fetchedAt: new Date().toISOString(),
        ...structuredClone(EMPTY),
        unavailable: [],
      };
      settled.forEach((outcome, i) => {
        const name = names[i] as Section;
        if (outcome.status === "fulfilled") {
          (result as unknown as Record<Section, unknown>)[name] = outcome.value;
        } else {
          result.unavailable.push({ section: name, reason: message(outcome.reason) });
        }
      });

      if (result.unavailable.length === names.length) {
        throw new Error(
          `Could not read the graph schema: ${result.unavailable[0]?.reason ?? "no section answered"}`
        );
      }

      logger.info("graph schema fetched", {
        durationMs: Date.now() - start,
        nodeCount: result.stats.nodeCount,
        labels: Object.keys(result.stats.labels).length,
        unavailable: result.unavailable.map(u => u.section),
      });

      schemaCache = result;
      return result;
    } finally {
      schemaPending = null;
    }
  })();

  return schemaPending;
}

/** For tests -- clears both the cached value and any in-flight fetch. */
export function _resetGraphSchemaCache(): void {
  schemaCache = null;
  schemaPending = null;
}
