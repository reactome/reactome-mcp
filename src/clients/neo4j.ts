import neo4j, { Driver } from "neo4j-driver";
import {
  NEO4J_URI,
  NEO4J_USER,
  NEO4J_PASSWORD,
  NEO4J_DATABASE,
} from "../config.js";
import { logger } from "../logger.js";

let driverInstance: Driver | null = null;

export function isNeo4jConfigured(): boolean {
  return Boolean(NEO4J_URI);
}

function isLocalhost(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function warnIfInsecureRemote() {
  if (!NEO4J_URI) return;
  if (isLocalhost(NEO4J_URI)) return;
  const passwordIsDefault = !process.env.NEO4J_PASSWORD;
  if (passwordIsDefault) {
    logger.warn(
      "NEO4J_URI points to a non-localhost host but NEO4J_PASSWORD is unset; using the default 'neo4j' password. Set NEO4J_PASSWORD explicitly for remote databases.",
      { uri: NEO4J_URI }
    );
  }
}

export function getDriver(): Driver {
  if (!NEO4J_URI) {
    throw new Error(
      "Neo4j is not configured. Set NEO4J_URI to enable Cypher tools."
    );
  }
  if (!driverInstance) {
    warnIfInsecureRemote();
    driverInstance = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
      { disableLosslessIntegers: true }
    );
    logger.info("neo4j driver initialized", {
      uri: NEO4J_URI,
      database: NEO4J_DATABASE,
    });
    const shutdown = async () => {
      if (driverInstance) {
        await driverInstance.close();
        driverInstance = null;
      }
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("beforeExit", shutdown);
  }
  return driverInstance;
}

// JS `number` always serializes to Float64 over Bolt. Cypher features like
// LIMIT / SKIP require an Integer type on the server side, so coerce any
// safe-integer number (and bigint) params into the driver's Integer wrapper.
function coerceIntParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" && Number.isInteger(v) && Number.isSafeInteger(v)) {
      out[k] = neo4j.int(v);
    } else if (typeof v === "bigint") {
      out[k] = neo4j.int(v.toString());
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function runRead<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = getDriver().session({
    database: NEO4J_DATABASE,
    defaultAccessMode: neo4j.session.READ,
  });
  try {
    const result = await session.run(cypher, coerceIntParams(params));
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export interface GraphSchema {
  labels: string[];
  relationshipTypes: string[];
  propertiesByLabel: Record<string, { name: string; types: string[] }[]>;
}

export async function fetchGraphSchema(): Promise<GraphSchema> {
  interface LabelRow { label: string }
  interface RelRow { relationshipType: string }
  interface PropRow { nodeType: string; propertyName: string; propertyTypes: string[] | null }

  const [labelRows, relRows, propRows] = await Promise.all([
    runRead<LabelRow>("CALL db.labels() YIELD label RETURN label ORDER BY label"),
    runRead<RelRow>("CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType"),
    runRead<PropRow>("CALL db.schema.nodeTypeProperties() YIELD nodeType, propertyName, propertyTypes RETURN nodeType, propertyName, propertyTypes"),
  ]);

  const propertiesByLabel: Record<string, { name: string; types: string[] }[]> = {};
  for (const p of propRows) {
    const entry = propertiesByLabel[p.nodeType] ?? [];
    entry.push({ name: p.propertyName, types: p.propertyTypes ?? [] });
    propertiesByLabel[p.nodeType] = entry;
  }

  return {
    labels: labelRows.map((l) => l.label),
    relationshipTypes: relRows.map((r) => r.relationshipType),
    propertiesByLabel,
  };
}
