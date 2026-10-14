import neo4j, { type Driver } from "neo4j-driver";
import { CYPHER_QUERY_TIMEOUT_MS, neo4jConnection } from "../config.js";
import { GRAPH_ACCESS_OFF, isGraphAccessEnabled } from "../graph/gate.js";
import { logger } from "../logger.js";

/**
 * The only place in this server that constructs a Neo4j driver.
 *
 * `tests/graph-access-gate.test.ts` asserts no other source file imports
 * `neo4j-driver`, so every connection comes through `getDriver()` -- and
 * `getDriver()` asks the gate itself. A surface that forgot to check the gate
 * would still get no driver.
 */

let driverInstance: Driver | null = null;

function isLoopback(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

export function getDriver(): Driver {
  // Asked on every call, not only the first: a driver built while the gate
  // was open is not a licence to keep using it once it is not.
  if (!isGraphAccessEnabled()) throw new Error(GRAPH_ACCESS_OFF);

  if (!driverInstance) {
    const { uri, user, password, database } = neo4jConnection();
    if (!uri) throw new Error(GRAPH_ACCESS_OFF);

    if (!isLoopback(uri) && !password) {
      logger.warn("NEO4J_URI is not a loopback address and NEO4J_PASSWORD is unset", {
        hint: "Keep the graph database on loopback, or require authentication.",
      });
    }

    const auth = password === undefined ? undefined : neo4j.auth.basic(user, password);
    driverInstance = neo4j.driver(uri, auth, { disableLosslessIntegers: true });
    logger.info("neo4j driver initialized", { database: database ?? "(server default)" });

    // process.once expects a void-returning listener. Handing it an async
    // function meant a failed close rejected with nobody listening, which Node
    // turns into a hard exit on unhandled rejection.
    const onShutdown = () => {
      void closeDriver().catch((error: unknown) => {
        logger.warn("neo4j driver close failed during shutdown", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
    process.once("SIGINT", onShutdown);
    process.once("SIGTERM", onShutdown);
    process.once("beforeExit", onShutdown);
  }
  return driverInstance;
}

/** Close and forget the driver, if one was built. Safe to call when none was. */
export async function closeDriver(): Promise<void> {
  const driver = driverInstance;
  driverInstance = null;
  if (driver) await driver.close();
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

export interface RunReadOptions {
  timeoutMs?: number;
}

/**
 * Run one query in a READ-mode session, under a server-side timeout.
 *
 * READ mode makes the database refuse native writes (CREATE, MERGE, DELETE,
 * SET, REMOVE). The timeout is a transaction timeout: Neo4j terminates the
 * transaction if it runs longer, so a runaway traversal ends on the server
 * rather than merely being abandoned by this client.
 */
export async function runRead<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
  options: RunReadOptions = {}
): Promise<T[]> {
  const driver = getDriver();
  const { database } = neo4jConnection();
  const session = driver.session({
    ...(database ? { database } : {}),
    defaultAccessMode: neo4j.session.READ,
  });
  const timeout = options.timeoutMs ?? CYPHER_QUERY_TIMEOUT_MS;
  try {
    const result = await session.run(cypher, coerceIntParams(params), { timeout });
    return result.records.map(r => r.toObject() as T);
  } finally {
    await session.close();
  }
}
