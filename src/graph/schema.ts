import { runRead } from "../clients/neo4j.js";
import { logger } from "../logger.js";

export interface GraphSchema {
  fetchedAt: string;
  dbComponents: Array<{ name: string; versions: string[]; edition: string }>;
  stats: {
    nodeCount: number;
    relCount: number;
    labels: Record<string, number>;
    relTypes: Record<string, number>;
    relTypesCount: Record<string, number>;
  };
  schema: Record<string, unknown>;
  nodeTypeProperties: Array<{
    nodeType: string;
    nodeLabels: string[];
    propertyName: string;
    propertyTypes: string[];
    mandatory: boolean;
  }>;
  relTypeProperties: Array<{
    relType: string;
    sourceNodeLabels: string[];
    targetNodeLabels: string[];
    propertyName: string;
    propertyTypes: string[];
    mandatory: boolean;
  }>;
  indexes: unknown[];
  constraints: unknown[];
}

// apoc.meta.schema() can scan many nodes; give the schema queries a longer
// budget than the default Cypher-query timeout.
const SCHEMA_FETCH_TIMEOUT_MS = 60_000;

let schemaCache: GraphSchema | null = null;
let schemaPending: Promise<GraphSchema> | null = null;

/**
 * Fetch the live graph schema via APOC (+ fallbacks for indexes and
 * constraints). Cached in-memory after the first successful call so
 * subsequent tool invocations are free. Concurrent first-callers share
 * one round-trip via the `schemaPending` promise.
 */
export async function fetchGraphSchema(): Promise<GraphSchema> {
  if (schemaCache) return schemaCache;
  if (schemaPending) return schemaPending;

  const opts = { timeoutMs: SCHEMA_FETCH_TIMEOUT_MS };
  const start = Date.now();

  schemaPending = (async () => {
    try {
      type Comp = { name: string; versions: string[]; edition: string };
      type Stats = GraphSchema["stats"];
      type NodeProp = GraphSchema["nodeTypeProperties"][number];
      type RelProp = GraphSchema["relTypeProperties"][number];

      const [components, stats, schemaRow, nodeProps, relProps, indexes, constraints] = await Promise.all([
        runRead<Comp>(
          "CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition",
          {},
          opts
        ),
        runRead<Stats>(
          "CALL apoc.meta.stats() YIELD labels, relTypes, relTypesCount, nodeCount, relCount RETURN labels, relTypes, relTypesCount, nodeCount, relCount",
          {},
          opts
        ),
        runRead<{ value: Record<string, unknown> }>(
          "CALL apoc.meta.schema() YIELD value RETURN value",
          {},
          opts
        ),
        runRead<NodeProp>(
          "CALL apoc.meta.nodeTypeProperties() YIELD nodeType, nodeLabels, propertyName, propertyTypes, mandatory RETURN nodeType, nodeLabels, propertyName, propertyTypes, mandatory",
          {},
          opts
        ),
        runRead<RelProp>(
          "CALL apoc.meta.relTypeProperties() YIELD relType, sourceNodeLabels, targetNodeLabels, propertyName, propertyTypes, mandatory RETURN relType, sourceNodeLabels, targetNodeLabels, propertyName, propertyTypes, mandatory",
          {},
          opts
        ).catch(() => [] as RelProp[]),
        runRead<unknown>(
          "CALL db.indexes() YIELD name, state, type, entityType, labelsOrTypes, properties RETURN name, state, type, entityType, labelsOrTypes, properties",
          {},
          opts
        ).catch(() => [] as unknown[]),
        runRead<unknown>(
          "CALL db.constraints() YIELD name, description RETURN name, description",
          {},
          opts
        ).catch(() => [] as unknown[]),
      ]);

      const result: GraphSchema = {
        fetchedAt: new Date().toISOString(),
        dbComponents: components,
        stats: stats[0] ?? {
          nodeCount: 0,
          relCount: 0,
          labels: {},
          relTypes: {},
          relTypesCount: {},
        },
        schema: schemaRow[0]?.value ?? {},
        nodeTypeProperties: nodeProps,
        relTypeProperties: relProps,
        indexes,
        constraints,
      };

      logger.info("graph schema fetched", {
        durationMs: Date.now() - start,
        nodeCount: result.stats.nodeCount,
        relCount: result.stats.relCount,
        labels: Object.keys(result.stats.labels ?? {}).length,
      });

      schemaCache = result;
      return result;
    } finally {
      schemaPending = null;
    }
  })();

  return schemaPending;
}

/** For tests — clears both the cached value and any in-flight fetch. */
export function _resetGraphSchemaCache(): void {
  schemaCache = null;
  schemaPending = null;
}
