import type { Driver, Session } from "neo4j-driver";
import { CYPHER_QUERY_TIMEOUT_MS, neo4jConnection } from "../config.js";
import { GRAPH_ACCESS_OFF, isGraphAccessEnabled } from "../graph/gate.js";
import { logger } from "../logger.js";

/**
 * The only place in this server that loads `neo4j-driver` or constructs a
 * driver.
 *
 * `tests/graph-access-gate.test.ts` asserts no other source file imports
 * `neo4j-driver`, so every connection comes through `getDriver()`, and
 * `getDriver()` asks the gate itself: a surface that forgot to check the gate
 * still gets no driver. The library is imported dynamically, after that
 * check, so an instance with graph access off never loads it at all. The type
 * import above is erased at compile time.
 */

/** The parts of the library this file uses. */
type Neo4jModule = Pick<typeof import("neo4j-driver"), "driver" | "auth" | "session" | "int">;

let driverPromise: Promise<{ neo4j: Neo4jModule; driver: Driver }> | null = null;

function isLoopback(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

async function build(): Promise<{ neo4j: Neo4jModule; driver: Driver }> {
  const { uri, user, password, database } = neo4jConnection();
  if (!uri) throw new Error(GRAPH_ACCESS_OFF);

  const neo4j: Neo4jModule = (await import("neo4j-driver")).default;

  if (!isLoopback(uri) && !password) {
    logger.warn("NEO4J_URI is not a loopback address and NEO4J_PASSWORD is unset", {
      hint: "Keep the graph database on loopback, or require authentication.",
    });
  }

  const auth = password === undefined ? undefined : neo4j.auth.basic(user, password);
  const driver = neo4j.driver(uri, auth, { disableLosslessIntegers: true });
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

  return { neo4j, driver };
}

async function connection(): Promise<{ neo4j: Neo4jModule; driver: Driver }> {
  // Asked on every call, not only the first: a driver built while the gate
  // was open is not a licence to keep using it once it is not.
  if (!isGraphAccessEnabled()) throw new Error(GRAPH_ACCESS_OFF);
  // One promise, so concurrent first callers share one driver.
  driverPromise ??= build().catch((error: unknown) => {
    driverPromise = null;
    throw error;
  });
  return driverPromise;
}

export async function getDriver(): Promise<Driver> {
  return (await connection()).driver;
}

/** Close and forget the driver, if one was built. Safe to call when none was. */
export async function closeDriver(): Promise<void> {
  const pending = driverPromise;
  driverPromise = null;
  if (!pending) return;
  const built = await pending.catch(() => null);
  if (built) await built.driver.close();
}

// JS `number` always serializes to Float64 over Bolt. Cypher features like
// LIMIT / SKIP require an Integer type on the server side, so coerce any
// safe-integer number (and bigint) params into the driver's Integer wrapper.
function coerceIntParams(neo4j: Neo4jModule, params: Record<string, unknown>) {
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

async function readSession(fetchSize?: number): Promise<{ neo4j: Neo4jModule; session: Session }> {
  const { neo4j, driver } = await connection();
  const { database } = neo4jConnection();
  const session = driver.session({
    ...(database ? { database } : {}),
    defaultAccessMode: neo4j.session.READ,
    ...(fetchSize ? { fetchSize } : {}),
  });
  return { neo4j, session };
}

/**
 * Run one query in a READ-mode session, under a server-side timeout, and
 * return every row. For the schema queries, whose results are bounded by the
 * schema; a caller's query goes through `runReadLimited`.
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
  const { neo4j, session } = await readSession();
  const timeout = options.timeoutMs ?? CYPHER_QUERY_TIMEOUT_MS;
  try {
    const result = await session.run(cypher, coerceIntParams(neo4j, params), { timeout });
    return result.records.map(r => r.toObject() as T);
  } finally {
    await session.close();
  }
}

/**
 * Like `runRead`, but reads at most `maxRows + 1` rows and then stops.
 *
 * The rows are streamed, in batches no larger than that, and the rest of the
 * result is discarded on the server once enough have arrived -- so
 * `MATCH (n) RETURN n` reads a handful of nodes into this process rather than
 * every node in the graph. The extra row is how `more` is known without
 * counting the rest.
 */
export async function runReadLimited<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown>,
  maxRows: number,
  options: RunReadOptions = {}
): Promise<{ rows: T[]; more: boolean }> {
  const { neo4j, session } = await readSession(Math.min(maxRows + 1, 1000));
  const timeout = options.timeoutMs ?? CYPHER_QUERY_TIMEOUT_MS;
  const rows: T[] = [];
  let more = false;
  try {
    const result = session.run(cypher, coerceIntParams(neo4j, params), { timeout });
    for await (const record of result) {
      if (rows.length === maxRows) {
        more = true;
        break; // ends the iteration, which discards the rest of the stream
      }
      rows.push(record.toObject());
    }
    return { rows, more };
  } finally {
    await session.close();
  }
}
