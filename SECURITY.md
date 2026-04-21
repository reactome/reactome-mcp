# Security Policy

## Reporting a Vulnerability

If you believe you have found a security issue in `reactome-mcp`, please **do not open a public GitHub issue**. Instead, report privately via GitHub's Security Advisory flow:

- Go to <https://github.com/reactome/reactome-mcp/security/advisories>
- Click **Report a vulnerability**

Include, where possible:

- A description of the issue and the potential impact
- Steps to reproduce (a minimal query, MCP config snippet, or command)
- Whether the issue affects the REST-client path, the Neo4j / Cypher path, or the web demo
- The version of `reactome-mcp` (see `package.json`) and any relevant runtime versions (Node, Neo4j server, APOC)

You can expect an acknowledgement within a few business days. We will coordinate a fix and, where appropriate, credit you in the advisory.

## Scope

In scope:

- The MCP server (`src/`, `dist/`) and its REST / Neo4j clients.
- The bundled web demo (`web/`).

Out of scope (report upstream):

- Vulnerabilities in `https://reactome.org` — report via the Reactome website.
- Vulnerabilities in Neo4j, APOC, or `neo4j-driver` — report via those projects.
- Vulnerabilities in Claude Desktop / Claude Code / the MCP SDK — report to the respective vendor.

## Threat Model (brief)

- The server is designed to be run locally by a trusted curator against either the public Reactome APIs or a local Reactome Neo4j image. It is **not** hardened for multi-tenant or internet-facing deployment without additional controls (auth, TLS, network isolation).
- The `reactome_cypher_query` tool runs in a Neo4j READ-mode session and rejects known APOC write-through procedures, but this is a guardrail, not a security boundary. For untrusted inputs, point at a read-only replica and configure Neo4j RBAC / plugin loading accordingly.
- The web demo (`web/mcp-bridge.js`) uses an allow-list CORS policy defaulting to localhost. Do not deploy it publicly without adding authentication.

## Handling of Secrets

- `NEO4J_PASSWORD` and any future credential env vars are read at process start and passed to the driver. They are never logged. REST error bodies are logged verbatim on failure — if you deploy against an authenticated proxy, ensure upstream errors do not echo credentials.
