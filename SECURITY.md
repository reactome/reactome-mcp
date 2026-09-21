# Security Policy

## Reporting a Vulnerability

If you believe you have found a security issue in `reactome-mcp`, please **do not open a public GitHub issue**. Instead, report privately via GitHub's Security Advisory flow:

- Go to <https://github.com/reactome/reactome-mcp/security/advisories>
- Click **Report a vulnerability**

Include, where possible:

- A description of the issue and the potential impact
- Steps to reproduce (a minimal query, MCP config snippet, or command)
- Whether the issue affects the REST-client path, the HTTP transport, or the web demo
- The version of `reactome-mcp` (see `package.json`) and any relevant runtime versions (Node)

You can expect an acknowledgement within a few business days. We will coordinate a fix and, where appropriate, credit you in the advisory.

## Scope

In scope:

- The MCP server (`src/`, `dist/`) and its REST clients.
- The bundled web demo (`web/`).

Out of scope (report upstream):

- Vulnerabilities in `https://reactome.org` — report via the Reactome website.
- Vulnerabilities in Claude Desktop / Claude Code / the MCP SDK — report to the respective vendor.

## Threat Model (brief)

- The server reads the public Reactome Content and Analysis Services over HTTP and holds no database credentials. As of 2026-09-21 it has **no graph database access at all**: the Cypher tools, the graph schema resource and the `neo4j-driver` dependency were removed when the server began to be hosted publicly. `NEO4J_URI` and `MCP_ALLOW_CYPHER` are inert — nothing reads them.
- It is still **not** self-hardened for internet-facing deployment: it has no authentication, no TLS and no rate limiting of its own. A public deployment must put those at the reverse proxy, and should bind the server to loopback so the proxy is the only way in. What removing graph access changes is the blast radius if that proxy is misconfigured — a caller reaching the server directly can make the same calls a browser can make against reactome.org, and nothing more.
- Tool inputs are bounded: every list argument has an explicit maximum, and `MAX_ANALYSIS_IDENTIFIERS` caps what one call may submit to the Analysis Service. The HTTP transport separately refuses a request body over 100 KiB.
- The web demo (`web/mcp-bridge.js`) uses an allow-list CORS policy defaulting to localhost. Do not deploy it publicly without adding authentication.

## Handling of Secrets

- The server holds no credentials of its own. REST error bodies are logged verbatim on failure — if you deploy behind an authenticated proxy, ensure upstream errors do not echo credentials.
