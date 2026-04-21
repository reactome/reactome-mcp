import neo4j, { Driver } from "neo4j-driver";
import {
  NEO4J_URI,
  NEO4J_USER,
  NEO4J_PASSWORD,
  NEO4J_DATABASE,
} from "../config.js";

let driverInstance: Driver | null = null;

export function isNeo4jConfigured(): boolean {
  return Boolean(NEO4J_URI);
}

export function getDriver(): Driver {
  if (!NEO4J_URI) {
    throw new Error(
      "Neo4j is not configured. Set NEO4J_URI to enable Cypher tools."
    );
  }
  if (!driverInstance) {
    driverInstance = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
      { disableLosslessIntegers: true }
    );
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

export async function runRead<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = getDriver().session({
    database: NEO4J_DATABASE,
    defaultAccessMode: neo4j.session.READ,
  });
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}
