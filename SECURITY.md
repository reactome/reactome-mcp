# Security Policy

## Reporting a Vulnerability

If you believe you have found a security issue in `reactome-mcp`, please **do not open a public GitHub issue**. Instead, report privately via GitHub's Security Advisory flow:

- Go to <https://github.com/reactome/reactome-mcp/security/advisories>
- Click **Report a vulnerability**

Include, where possible:

- A description of the issue and the potential impact
- Steps to reproduce (a minimal query, MCP config snippet, or command)
- Whether the issue affects the REST-client path, the HTTP transport, the graph database (Cypher) path, or the web demo
- The version of `reactome-mcp` (see `package.json`) and any relevant runtime versions (Node, Neo4j)

You can expect an acknowledgement within a few business days. We will coordinate a fix and, where appropriate, credit you in the advisory.

## Scope

In scope:

- The MCP server (`src/`, `dist/`), its REST clients and its optional Neo4j client.
- The bundled web demo (`web/`).

Out of scope (report upstream):

- Vulnerabilities in `https://reactome.org` — report via the Reactome website.
- Vulnerabilities in Neo4j or `neo4j-driver` — report via those projects.
- Vulnerabilities in Claude Desktop / Claude Code / the MCP SDK — report to the respective vendor.

## Threat Model (brief)

- By default the server reads the public Reactome Content and Analysis Services over HTTP and holds no database credentials.
- **Graph database access is off unless both `NEO4J_URI` and `MCP_ALLOW_CYPHER=1` are set**, and a publicly reachable instance must never set them. With either missing there are no Cypher tools, no graph schema resource, no mention of either in the server instructions, and no Neo4j driver is ever constructed — `getDriver()` checks the same predicate as every surface, so a surface that forgot to check still could not connect. `tests/graph-access-gate.test.ts` holds this for every entrypoint in every combination of the two variables.
- With graph access on, queries run in READ-mode sessions under a server-side timeout, queries are checked against an allowlist before execution (`CALL` only for the built-in schema procedures and no `CALL` subqueries, `SHOW` only for indexes and constraints, no APOC, `LOAD CSV`, `USE`, `TERMINATE` or write/admin clause), checked on a tokenisation of the query rather than its raw text,, and rows are streamed and cut off at the row cap rather than read whole. That is a guardrail against accidents, not a boundary against a hostile caller: an expensive read can still load the database. Use a dedicated database, reachable on loopback only, and configure Neo4j's own authentication and plugin settings accordingly.
- It is **not** self-hardened for internet-facing deployment: it has no authentication, no TLS and no rate limiting of its own. A public deployment must put those at the reverse proxy, and should bind the server to loopback so the proxy is the only way in. With graph access off, a caller reaching the server directly can make the same calls a browser can make against reactome.org, and nothing more.
- Tool inputs are bounded: every list argument has an explicit maximum, and `MAX_ANALYSIS_IDENTIFIERS` caps what one call may submit to the Analysis Service. The HTTP transport separately refuses a request body over 100 KiB.
- The web demo (`web/mcp-bridge.js`) uses an allow-list CORS policy defaulting to localhost. Do not deploy it publicly without adding authentication.

## Handling of Secrets

- With graph access off the server holds no credentials of its own. `NEO4J_PASSWORD`, when set, is read when the driver is built and passed to it; it is never logged. REST error bodies are logged verbatim on failure — if you deploy behind an authenticated proxy, ensure upstream errors do not echo credentials.
