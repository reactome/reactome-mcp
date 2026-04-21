# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] — 2026-04-21

### Added
- **MCP server `instructions`** — the server now sends orientation instructions in its `initialize` response: tool-category taxonomy, ID conventions, recommended workflow, and (if `NEO4J_URI` is set) Cypher-specific guidance including the "call schema first" rule and the APOC denylist. Clients like Claude Code read this on connection, so no external prompt engineering is needed.
- **README: Example prompts** — a "try these" block with REST and Cypher starter prompts so curators know what to ask on day one.

## [1.3.0] — 2026-04-21

### Added
- **Request correlation IDs.** Every tool invocation now runs inside a fresh `AsyncLocalStorage` context with a short `reqId`; the logger auto-injects it into every log line emitted during that invocation, so retries, errors, and Neo4j calls for one request can all be grepped together. 4 new tests.
- **`.max(2048)` on every REST-tool string input.** Swept all of `src/tools/*.ts` and `src/tools/index.ts`. Defence-in-depth against oversized payloads on the REST side; the Cypher query already had a 50k cap.
- **Handler-level tests.** New `tests/tools.test.ts` + `tests/helpers/fake-server.ts` harness that captures `server.tool` registrations; representative happy-path tests for pathway, search, entity, and interactor tools (6 new tests). Not exhaustive — covers the pattern for future additions.
- **Governance files**: `.github/CODEOWNERS` (placeholder team handle), `SECURITY.md` with reporting flow + scope + threat-model notes, `.github/dependabot.yml` for weekly npm + monthly actions updates.

## [1.2.0] — 2026-04-21

### Added
- **Cypher query timeout.** `runRead` now passes a server-side transaction timeout so runaway queries are terminated rather than hanging the MCP server. Defaults to 30s, override via `CYPHER_QUERY_TIMEOUT_MS` env.
- **APOC write-through guard.** `reactome_cypher_query` rejects queries calling APOC procedures that bypass READ-mode sessions (`apoc.cypher.runWrite` / `apoc.cypher.doIt`, `apoc.periodic.*`, `apoc.create/merge/refactor.*`, `apoc.load/import/export.*`, `apoc.trigger.*`, `apoc.nodes.delete`). 13 new tests cover the guard.
- **Query length cap.** `reactome_cypher_query` rejects queries over 50,000 characters at the zod-validation layer.

### Changed
- README and tool description now describe READ mode as a guardrail against accidental mutation rather than a security boundary, explicitly noting that the real trust boundary lives at the Neo4j RBAC / plugin layer.

## [1.1.0] — 2026-04-21

### Added
- **Opt-in Neo4j Cypher tools** (`reactome_cypher_query`, `reactome_cypher_schema`, `reactome_cypher_sample`), registered only when `NEO4J_URI` is set. Sessions run in READ mode so write clauses are rejected by the server. Defaults match the [`reactome_neo4j_env`](https://github.com/reactome/reactome_neo4j_env) Docker image (auth-disabled, database `graph.db`).
- **`reactome://graph/schema` resource** — exposes labels, relationship types, and per-label property keys so clients can plan queries without a round-trip through the tool layer.
- **`REACTOME_BASE_URL` env var** — override the Content Service / Analysis Service base URL (e.g. point at a staging or release-specific host). Finer-grained `REACTOME_CONTENT_SERVICE_URL` / `REACTOME_ANALYSIS_SERVICE_URL` also honored.
- **Retry with exponential backoff** for all REST calls. Retries 429 and 5xx with jittered backoff; honors `Retry-After`. Up to 3 attempts.
- **Structured JSON logging** on stderr. Configurable via `LOG_LEVEL` (`debug`/`info`/`warn`/`error`). stdout is reserved for the MCP protocol.
- **Per-row and total-response size caps** on `reactome_cypher_query` (`max_row_chars`, `max_total_chars`), so a single wide node can't blow the LLM context budget. Over-wide rows are replaced with a summary object listing keys + original size.
- **Test suite** (Vitest) and **GitHub Actions CI** — typecheck + tests on Node 18/20/22.
- **`prepare` script + `files` whitelist** so `npm install` from a clone auto-builds and `npm publish` ships only `dist/`, `README`, and `LICENSE`.

### Changed
- Server version reported as `1.1.0` in MCP handshake.
- Web demo (`web/mcp-bridge.js`) CORS is now allow-listed (defaults to localhost). Override with `ALLOWED_ORIGINS=…` (comma-separated) or `ALLOWED_ORIGINS=*` to explicitly opt in to wildcard.

### Fixed
- Integer Cypher parameters (e.g. the `$limit` in `MATCH (n) RETURN n LIMIT $limit`) are now coerced to the driver's Integer wrapper in `runRead`. Without this, Neo4j 4.3 rejects the query because JS `number` serializes as Float64 over Bolt.

### Security
- Non-localhost `NEO4J_URI` with an unset `NEO4J_PASSWORD` now logs a warning at driver init.

## [1.0.0] — Initial release

- 40+ tools wrapping Reactome's Content Service and Analysis Service REST APIs.
- 10 MCP resources (static + templated).
- stdio transport.
