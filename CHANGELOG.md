# Changelog

## 2026-03-19

### Added

#### Initial automated smoke test suite

Files:
- `test/server-registration.test.ts`
- `test/tools-smoke.test.ts`
- `test/resources-smoke.test.ts`
- `test/helpers/mcp-test-utils.ts`
- `test/run-tests.ts`

Why this was added:
- The project did not have automated coverage for MCP surface registration or basic handler behavior.
- These tests provide a fast offline check that the server still exposes expected tools, resources, and templates.
- The tests stub the content and analysis client boundaries, so contributors can run them without depending on live Reactome services.

Purpose it serves:
- Catches accidental breakage in MCP registration.
- Verifies representative tool formatting and handler wiring.
- Verifies representative static resource and resource-template behavior.
- Gives contributors a small, readable starting point for expanding coverage.

#### Test-specific TypeScript build config

File:
- `tsconfig.test.json`

Why this was added:
- The existing TypeScript config only compiled `src/`.
- Tests need to compile cleanly alongside source files without changing the production build output.

Purpose it serves:
- Builds `src/` and `test/` into `dist-test/`.
- Keeps test artifacts separate from production artifacts in `dist/`.

#### Server factory for testability

File:
- `src/server.ts`

Why this was added:
- Server construction and registration were previously trapped in the runtime entrypoint.
- Tests needed a clean way to create the MCP server without connecting stdio transport.

Purpose it serves:
- Centralizes MCP server construction.
- Lets tests import and inspect a fully registered server.
- Preserves the runtime behavior while making initialization testable.

### Changed

#### Runtime entrypoint now uses shared server factory

File:
- `src/index.ts`

What changed:
- Replaced inline server creation with `createServer()`.

Why this was changed:
- To avoid duplicating server construction logic between runtime and tests.

Purpose it serves:
- Keeps production startup behavior unchanged.
- Ensures runtime and tests use the same registration path.

#### Package scripts now support test compilation and execution

File:
- `package.json`

What changed:
- Added `build:test`.
- Added `test`.

Why this was changed:
- Contributors need a single command to build and run the new automated suite.

Purpose it serves:
- `npm test` now runs the smoke suite.
- Keeps the workflow simple and contributor-friendly.

#### Ignore test build artifacts

File:
- `.gitignore`

What changed:
- Added `dist-test/`.

Why this was changed:
- The new test build produces compiled output separate from `dist/`.

Purpose it serves:
- Prevents generated test artifacts from being committed accidentally.

#### Input validation tightened for clearer failure behavior

Files:
- `src/tools/search.ts`
- `src/tools/analysis.ts`

What changed:
- Search query inputs now require a non-empty trimmed string in representative search tools.
- Analysis token inputs now require a non-empty trimmed string in token-based analysis tools.

Why this was changed:
- Empty strings were previously accepted by schema validation, which made invalid-input behavior less clear.
- The test suite needed deterministic validation coverage for common bad inputs.

Purpose it serves:
- Produces clearer failures for missing/blank search queries.
- Produces clearer failures for missing/blank analysis tokens.
- Improves behavior without changing the core tool output shape.

### Notes

- The automated suite uses `node:test` and `node:assert/strict` to stay lightweight and compatible with the repository's Node support target.
- Tests are intentionally small smoke tests, not full endpoint-by-endpoint coverage.
- External Reactome network calls are avoided in automated tests by stubbing the client-layer methods used by handlers.
