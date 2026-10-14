import { logger } from "../logger.js";
import { isGraphAccessEnabled } from "./gate.js";
import { fetchGraphSchema } from "./schema.js";
import { GRAPH_GROUP, resolveToolGroups } from "../tools/index.js";

/**
 * Called by every entrypoint once it is serving. Never rejects.
 *
 * Warms the graph schema cache in the background when -- and only when --
 * this instance offers graph access, so the first `reactome_cypher_schema`
 * call does not pay for the schema procedures. With the gate closed, or the
 * `cypher` group withheld, nothing could read that cache, and warming it would
 * open a database connection for nobody.
 *
 * The decision lives here rather than at each call site, so every entrypoint
 * makes the same one.
 */
let warmupCalls = 0;
let warmupPending: Promise<void> | null = null;

export function warmGraphSchema(): void {
  warmupCalls++;
  let offered: boolean;
  try {
    offered = resolveToolGroups().includes(GRAPH_GROUP);
  } catch {
    // A bad MCP_TOOL_GROUPS is reported where the server is built.
    return;
  }

  if (!offered) {
    if (process.env.NEO4J_URI?.trim() && !isGraphAccessEnabled()) {
      // Said out loud: an operator who set NEO4J_URI expecting the Cypher
      // tools needs to know why they are absent.
      logger.warn("graph database access is OFF: MCP_ALLOW_CYPHER is not 1", {
        hint: "Set MCP_ALLOW_CYPHER=1 only on an instance that is not publicly reachable.",
      });
    }
    return;
  }

  const pending: Promise<void> = fetchGraphSchema()
    .then(() => undefined)
    .catch((error: unknown) => {
      logger.warn("graph schema warm-up failed; will retry on first use", {
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      if (warmupPending === pending) warmupPending = null;
    });
  warmupPending = pending;
}

/**
 * For tests: how many times an entrypoint has asked for the warm-up, and the
 * warm-up still running, if one is. Entrypoints start it without waiting, so
 * a test that asserts on what it did must wait for exactly this rather than
 * for a fixed time -- on a busy machine a fixed time is too short, and the
 * work lands in whichever test runs next. The promise never rejects.
 */
export function _graphSchemaWarmup(): { calls: number; pending: Promise<void> | null } {
  return { calls: warmupCalls, pending: warmupPending };
}
