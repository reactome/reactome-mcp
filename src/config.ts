const DEFAULT_BASE_URL = "https://reactome.org";

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const REACTOME_BASE_URL = normalizeBaseUrl(
  process.env.REACTOME_BASE_URL ?? DEFAULT_BASE_URL
);

export const CONTENT_SERVICE_URL =
  process.env.REACTOME_CONTENT_SERVICE_URL ?? `${REACTOME_BASE_URL}/ContentService/`;
export const ANALYSIS_SERVICE_URL =
  process.env.REACTOME_ANALYSIS_SERVICE_URL ?? `${REACTOME_BASE_URL}/AnalysisService/`;

/**
 * ReactomeGSA, which is a different service from the Analysis Service and does
 * a different thing.
 *
 *   AnalysisService  over-representation over a list of identifiers
 *   ReactomeGSA      gene set analysis over an expression matrix -- PADOG,
 *                    Camera ("similar to the classical GSEA algorithm"),
 *                    ssGSEA, terapadog
 *
 * Nothing here talked to it until now, which is why a user asking this server's
 * chatbot to "run a GSEA" was told Reactome could not, and offered fgsea and a
 * YouTube tutorial instead. Reactome can; it just was not reachable from here.
 */
export const GSA_SERVICE_URL = normalizeBaseUrl(
  process.env.REACTOME_GSA_SERVICE_URL ?? "https://gsa.reactome.org/0.1"
);

export const DEFAULT_SPECIES = "Homo sapiens";
export const DEFAULT_PAGE_SIZE = 25;

export const SORT_OPTIONS = [
  "NAME",
  "TOTAL_ENTITIES",
  "TOTAL_INTERACTORS",
  "TOTAL_REACTIONS",
  "FOUND_ENTITIES",
  "FOUND_INTERACTORS",
  "FOUND_REACTIONS",
  "ENTITIES_RATIO",
  "ENTITIES_PVALUE",
  "ENTITIES_FDR",
  "REACTIONS_RATIO",
] as const;

export const RESOURCE_TYPES = [
  "TOTAL",
  "UNIPROT",
  "ENSEMBL",
  "CHEBI",
  "IUPHAR",
  "MIRBASE",
  "NCBI_PROTEIN",
  "EMBL",
  "COMPOUND",
] as const;

export const DIAGRAM_FORMATS = ["png", "jpg", "jpeg", "svg", "gif"] as const;

export const NEO4J_URI = process.env.NEO4J_URI;
export const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "neo4j";
export const NEO4J_DATABASE = process.env.NEO4J_DATABASE ?? "graph.db";

/**
 * Whether the Cypher tools may be registered at all.
 *
 * Default-deny, and deliberately a separate switch from `NEO4J_URI`.
 *
 * Until 2026-09-21 the Cypher tools appeared whenever `NEO4J_URI` was set,
 * which made "can the public run arbitrary graph queries" a side effect of a
 * connection string rather than a decision. That is the wrong shape for this
 * particular capability: a deployment might set `NEO4J_URI` for any number of
 * good reasons -- the graph-schema warm-up, a future non-Cypher graph tool --
 * and would silently publish `reactome_cypher_query` by doing so.
 *
 * So it is an opt-in. Forgetting it costs a missing tool on an internal
 * instance, which is visible and harmless. Forgetting the inverse would have
 * cost arbitrary query access on a public one.
 */
export const ALLOW_CYPHER_TOOLS = process.env.MCP_ALLOW_CYPHER === "1";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(n)) return fallback;
  return n;
}

export const CYPHER_QUERY_TIMEOUT_MS = parsePositiveInt(
  process.env.CYPHER_QUERY_TIMEOUT_MS,
  30_000
);

/**
 * Backstop on how much text one tool may return.
 *
 * Every tool result is spent from the model's context window, and several here
 * can be far larger than they look: `reactome_query` on Metabolism renders
 * ~60 KB (~15k tokens) and `reactome_events_hierarchy` ~86 KB (~22k tokens),
 * because the size is driven by the ID that was asked about rather than by
 * anything the tool decides. A single call could crowd out the conversation it
 * was meant to inform.
 *
 * This is a backstop, not a target -- tools should page or summarise long
 * before reaching it. It matches the Cypher tool's existing total-size default,
 * which had this guard from the start while the REST tools had none.
 */
export const MAX_TOOL_RESPONSE_CHARS = parsePositiveInt(
  process.env.MAX_TOOL_RESPONSE_CHARS,
  40_000
);

/**
 * HTTP transport. Off unless a port is set -- stdio stays the default, because
 * that is what every existing user's client is configured for.
 *
 * The host defaults to loopback deliberately. The Reactome site already learned
 * this lesson the expensive way: crawlers on the public `/ContentService/
 * exporter/*` URLs exhausted Tomcat's heap and took the origin down, which is
 * why the sibling render service on that box binds 127.0.0.1 only and is
 * reached through the site's own origin. An MCP endpoint is the same shape of
 * risk and worse per request -- `reactome_analyze_identifiers` submits a real
 * job to the Analysis Service.
 *
 * Binding elsewhere is possible and deliberate: set MCP_HTTP_HOST. Do that
 * behind something that rate-limits.
 */
export const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT
  ? parsePositiveInt(process.env.MCP_HTTP_PORT, 0)
  : undefined;
export const MCP_HTTP_HOST = process.env.MCP_HTTP_HOST ?? "127.0.0.1";

/** How long an idle session is kept before its server is torn down. */
export const MCP_SESSION_TTL_MS = parsePositiveInt(process.env.MCP_SESSION_TTL_MS, 30 * 60_000);

/** Ceiling on concurrent sessions, so a client loop cannot exhaust memory. */
export const MCP_MAX_SESSIONS = parsePositiveInt(process.env.MCP_MAX_SESSIONS, 256);

/**
 * Most identifiers one `reactome_analyze_identifiers` call may submit.
 *
 * The list is POSTed to the Analysis Service, which does real work and stores
 * a result against a token.
 *
 * The first version of this cap was justified by calling that an unbounded
 * amplification. **That was overstated for the transport it matters on.**
 * Measured against the code as it stood, HTTP already refused a body over
 * 100 KiB, so the list was in practice bounded near 14,600 short identifiers
 * -- by express's default, not by anything anyone here decided. What is
 * genuinely unbounded is stdio, which has no such ceiling.
 *
 * So this cap earns its place more modestly than first claimed: over HTTP it
 * makes the bound *predictable* (3,000 regardless of identifier length,
 * instead of somewhere between 4,000 and 14,600 depending on how long the
 * identifiers happen to be) and turns an opaque 413 into a validation error
 * naming the limit; over stdio it is the only bound there is.
 *
 * 3,000 is chosen to fit, not for its own sake. The HTTP transport's body
 * ceiling is express's 100 KiB default (see `startHttpServer`), and a
 * `tools/call` carrying 3,000 identifiers of 20 characters comes to about
 * 69 KB -- a third of the ceiling left spare, so a request at this cap gets
 * a validation error naming the limit rather than a bare 413 from the
 * transport. A cap the transport refuses to deliver is not a cap, it is two
 * disagreeing ones. 4,000 was tried first and left only 10% headroom, which
 * the test rejected: a cap that only just fits is one identifier-length
 * change away from being unreachable again.
 *
 * `tests/body-limit.test.ts` asserts the two still agree. stdio has no such
 * ceiling, so a private instance that needs a whole proteome can raise this.
 */
export const MAX_ANALYSIS_IDENTIFIERS = parsePositiveInt(
  process.env.MCP_MAX_ANALYSIS_IDENTIFIERS,
  3_000
);
