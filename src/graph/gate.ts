/**
 * Whether this instance has graph database access at all.
 *
 * **Both** of these, or nothing:
 *
 *     NEO4J_URI          set to a non-blank connection string
 *     MCP_ALLOW_CYPHER   exactly "1"
 *
 * This is the one predicate. Every surface that touches the graph asks it --
 * tool registration, the `reactome://graph/schema` resource, the server
 * instructions, the startup schema warm-up, and `getDriver()` itself, which
 * refuses to construct a driver when it is false. Asking it at the driver as
 * well as at each surface is deliberate: the last gate this server had was
 * consulted in four places, and the HTTP entrypoint -- the one actually
 * hosted -- opened a connection on `NEO4J_URI` alone. A door that forgets to
 * ask still cannot get a driver.
 *
 * Two variables rather than one, on purpose. A connection string can be set
 * for many reasons and is easy to inherit from a shared environment file;
 * it is not consent to publish arbitrary query access. Forgetting the opt-in
 * costs a missing tool on an internal instance, which is visible and
 * harmless. Forgetting it the other way round on a public instance would cost
 * the database, and the website in front of it.
 *
 * Read from the environment on every call rather than captured at import, so
 * there is one copy of the answer and it cannot go stale.
 */
export function isGraphAccessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEO4J_URI?.trim()) && env.MCP_ALLOW_CYPHER === "1";
}

/** Why a graph operation was refused, with what would change the answer. */
export const GRAPH_ACCESS_OFF =
  "Graph database access is off. It needs both NEO4J_URI and MCP_ALLOW_CYPHER=1, " +
  "and must never be enabled on a publicly reachable instance.";
