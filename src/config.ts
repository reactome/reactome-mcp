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
