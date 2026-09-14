# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Ten tools read field paths the Reactome services never return.** Each called the right endpoint and reported success, so nothing flagged them: `contentClient.get<T>` asserts `T`, it does not verify it, and 51 of 56 tools had no test. `search_suggest` and `search_spellcheck` expected `{suggestions: []}` where the API returns a bare array; `entity_component_of` expected `Complex` objects where the API returns one entry per relationship type with parallel `names`/`stIds`/`schemaClasses` arrays; `participants` expected `stId` where the API returns `peDbId`; the four interactor tools read `score` one level above where it lives, throwing on `.toFixed`; `analysis_found_entities` read `mapsTo[].identifier` where the API returns `ids[]`. **`search_diagram` had never returned an answer** — it shared the grouped-results helper, but that endpoint returns a flat `entries` array, so every call threw `result.results is not iterable`.
- **Two tools dropped data silently, with no `undefined` to give it away.** `participants` never rendered external identifiers at all — the endpoint returns `refEntities` (an array), never a singular `referenceEntity`, so UniProt accessions were simply absent. `search_facets` returned nothing but its heading: each facet is an object with an `available` list, so `.length` on it was `undefined` and every section was skipped as falsy.
- **`reactome_query`'s `attribute` argument had never worked.** `/data/query/{id}/{attribute}` responds with `text/plain`, and the client asks for `application/json`, so every attribute request came back HTTP 406. It now uses the text path.
- **`events_hierarchy` walked the entire tree.** It capped at three top-level pathways but then recursed every descendant, so those three rendered ~86 KB. It now takes `max_depth` (default 3) and `top_level_limit`, and says where it stopped — ~86 KB down to ~16 KB.
- **`reactome_query` returned pretty-printed JSON**, which cost ~23% more tokens for whitespace no model needs. Objects too large to return whole are now described — field names, shapes and sizes, with a pointer to the `attribute` argument — instead of being truncated into invalid JSON. Metabolism goes from 43,457 characters of severed object to 1,327 characters of usable map.
- **`events_hierarchy` failed every call that did not name a species.** Its default was `"Homo sapiens"`, which that endpoint answers with HTTP 500; `"9606"` returns 200.
- A failed Neo4j driver close rejected with nobody listening — `process.once` was handed an `async` function.
- `fetchWithRetry` rethrew `lastError`, typed `unknown`, so a non-`Error` rejection reached callers as something they could not read `.message` off.

### Added
- **Streamable HTTP transport**, alongside stdio. `MCP_HTTP_PORT=4320 node dist/http-server.js`. stdio remains the default and is untouched — every existing client is configured to spawn it. This is what a hosted instance needs, because a reverse proxy cannot front a process that talks over stdin/stdout.

  Each session gets its own server instance, built by the `createServer()` factory. Idle sessions are reaped (`MCP_SESSION_TTL_MS`, 30 min) and concurrency is capped (`MCP_MAX_SESSIONS`, 256), so a client that never sends `DELETE` cannot accumulate servers until the process dies.

  `MCP_HTTP_HOST` defaults to `127.0.0.1`, which also enables the SDK's DNS-rebinding protection. That default is deliberate: the Reactome origin has already been taken down once by crawlers on public `/ContentService/exporter/*` URLs, and an MCP endpoint is the same shape of risk and worse per request.
- **A cap on how much text one tool may return** (`MAX_TOOL_RESPONSE_CHARS`, default 40,000; override by env). Every tool result is spent from the caller's context window, and the size of several of these is driven by the ID asked about rather than by anything the tool decides: `reactome_events_hierarchy` rendered ~86 KB (~22,000 tokens) in a single call and `reactome_query` on Metabolism ~60 KB. The cap is applied once, in the wrapper every tool handler already passes through, rather than in 56 places — and it announces the cut rather than truncating silently, because a model that cannot see it was truncated reports the partial answer as the whole one.
- **Spec Kit.** `.specify/` with a constitution written from failures this repository actually had, and `specs/` for design decisions. Spec 001 records what was found about response shapes; spec 002 states the transport and hosting question rather than answering it. The Spec Kit skills under `.claude/skills/` are tracked deliberately — people clone this repository and point an agent at it.
- **A live sweep.** `npm run sweep` calls all 53 tools against the live services. It checks for `undefined`, `[object Object]` and empty bodies, and — because marker-grepping cannot see a field that was dropped cleanly — asserts expected content for 16 tools whose arguments are known to return data. Runs weekly and on demand, not in CI, since a red run there can mean Reactome changed rather than this repository did.
- **ESLint with type-aware rules, and Prettier.** Plus coverage reporting with a ratchet threshold, and a `tsconfig.eslint.json` that finally includes `tests/` — which had been in no TypeScript project at all.
- **`createServer()`** (`src/server.ts`) builds a fully-registered server with no transport attached, so construction no longer happens at module scope and a hosted deployment can serve a second transport per session. **Harvested from #5 by [@adidev001](https://github.com/adidev001).**
- **`nonEmptyString`** (`src/schemas.ts`), shared by 83 argument schemas. Blank and whitespace-only arguments are rejected at the schema instead of reaching the service as a confusing 404 or a request for everything. Keeps the 2048-character cap added in 1.3.0. **Also from #5 by [@adidev001](https://github.com/adidev001).**

### Changed
- **zod 4**, **neo4j-driver 6**, **vitest 5**, **@types/node 26**. `z.record(v)` now requires an explicit key type; that was the only breaking change reaching this code.
- CI now runs lint, format check, typecheck, **build** and coverage. The build had never run in CI.
- **The test harness now runs zod validation.** `fake.invoke()` called handlers with raw arguments, so schemas never ran: defaults never materialised and invalid input was never rejected. No test had ever exercised the `nonEmptyString` validation, and a test could pass while the real server requested `/data/eventsHierarchy/undefined`.
- Test suite: 41 → 81 tests.

- **TypeScript 5.9 → 7**, via the side-by-side arrangement the TypeScript team documents. The build and typecheck run TypeScript 7 (installed as the alias `typescript-7`); the package named `typescript` stays at 6.0.3 because that is the newest typescript-eslint supports. Builds go from ~2.6s to ~0.38s, and `npm run check` typechecks with both compilers so they cannot diverge silently. TypeScript 6 stopped auto-including `@types/*`, so `tsconfig.json` now names `"types": ["node"]` — the lint config already did.

  Scripts invoke the compiler **by path** rather than calling `tsc`: both packages ship a `tsc` binary, and `node_modules/.bin/tsc` was observed pointing at 7.0.2 after an incremental install and 6.0.3 after a clean `npm ci` on the same tree. A bare `tsc` would compile with a different compiler depending on how the tree was installed.

### Held
- **Moving the `typescript` package itself to 7.** typescript-eslint throws on TS >= 7, so bumping it would disable linting while changing nothing about the build, which already uses 7. Tracked in #29; dependabot ignores TypeScript major bumps until it closes, at which point the alias goes away.

## [1.4.0] — 2026-04-24

### Changed
- **`reactome_cypher_schema` and `reactome://graph/schema` now return rich APOC-level data.** The previous implementation used the sparse built-in `db.schema.*` (labels / rel types / property names only). This release pulls `apoc.meta.schema()`, `apoc.meta.stats()`, `apoc.meta.{node,rel}TypeProperties()`, `db.indexes()`, `db.constraints()`, and `dbms.components()` — so clients see **per-label node counts**, **relationship cardinalities**, **property types with mandatory flags**, indexes, and constraints. The markdown digest jumps from ~40 KB (sparse) to ~80 KB (rich).
- Fetch is lazy + cached in-memory for the session. Concurrent first-callers share one round-trip via promise deduplication.

### Added
- **Startup schema prefetch.** `main()` fires `fetchGraphSchema()` in the background once the MCP is listening, so the first `reactome_cypher_schema` call doesn't wait 15–30 s on `apoc.meta.schema()` (that procedure samples 3M nodes on Reactome). Failures are logged; the cache stays empty and the next tool call retries on demand.
- 7 new tests: markdown format coverage (4) + cache behavior (caching, concurrent dedup, optional-call fallback).

### Removed
- The sparse `db.schema.*`-based schema path. No fallback — APOC is required for the Cypher schema tool. This is fine for the `reactome_neo4j_env` Docker image (APOC is always present); other deployments must load APOC for schema tooling to work.

### Notes
- **No vendored schema artifact.** The MCP fetches live on connect. No coordination with `reactome_neo4j_env` release cadence is required.

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
