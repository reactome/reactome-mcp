# 002 — Transports and hosting

**Status:** transport settled 2026-09-14; where it runs is still open
**Date:** 2026-09-14
**Constitution:** Principles IV, V

## Problem

The server speaks stdio only. Every user clones the repository, builds it, and
configures an agent to spawn it locally. That works for the handful of people
doing it today and does not scale to "Reactome offers an MCP endpoint".

## What is decided

**Construction is separate from transport.** `createServer()` builds a
fully-registered server with no transport attached; `src/index.ts` is the stdio
entrypoint that calls it. Nothing is constructed at module scope, so importing
the entrypoint no longer starts a server.

This is a prerequisite, not the answer. A hosted deployment needs one server per
session and a second transport from the same registrations — neither is possible
while the only instance is a module-scope constant. The idea is harvested from
#5 by @adidev001.

**No Neo4j from a deployed instance.** Superseded 2026-09-21 by something
stronger: the graph tools were removed outright, along with the schema resource
and the `neo4j-driver` dependency, so there is no gate to hold. A public endpoint
holding database credentials is a different security proposition from one that
can only make the calls a browser can — and a gate makes that a property of the
configuration, which is how `src/http-server.ts` came to keep opening a
connection on `NEO4J_URI` alone after the other call sites were fixed.
`tests/no-graph-access.test.ts` asserts the absence with the old switches on.

**Analysis runs in the Analysis Service.** The server submits identifiers, holds
the token, and formats the reply.

## Settled 2026-09-14: the transport exists

Streamable HTTP ships alongside stdio. stdio stays the default and is unchanged.

  - `MCP_HTTP_PORT=4320 node dist/http-server.js`
  - `POST /mcp`, `GET /mcp`, `DELETE /mcp`, `GET /health`
  - one server per session, built by `createServer()`
  - idle sessions reaped at 30 min, concurrency capped at 256
  - binds `127.0.0.1` unless told otherwise, which also turns on the SDK's
    DNS-rebinding protection

This was the blocker for everything below: a reverse proxy cannot front a
process that speaks over stdin/stdout, so there was previously nothing to host.

### The brief for whoever adds it to the website repo

That repository already runs this exact pattern. `render` is a sibling Node
service in the same compose file, bound loopback-only, reached through the
site's own origin; `serve-prod.js` reads the proxy table from `proxy.conf.js`,
so beta and the dev server both proxy it the same way; and
`deploy/apache/beta-chat-proxy.conf` shows how a service gets a path on the
beta vhost.

So the work is three small things, not a design exercise:

  1. a compose service running `dist/http-server.js` with `MCP_HTTP_PORT` set,
     published on `127.0.0.1` only -- copy what `render` does
  2. an entry in `proxy.conf.js` so the origin forwards a path to it
  3. an Apache stanza on beta, modelled on `beta-chat-proxy.conf`

**Loopback only to begin with.** Not because public access is wrong, but
because it is a separate decision that needs rate limiting attached, and the
comments on the render service record why: crawlers on the public
`/ContentService/exporter/*` URLs exhausted Tomcat's heap and took the origin
down. An MCP endpoint is the same shape of risk and worse per request --
`reactome_analyze_identifiers` submits a real job to the Analysis Service.

## What is open

1. ~~**Who adds Streamable HTTP, and when.**~~ *Settled: it is in, see above.*

2. **Where a hosted instance runs.** Spinning it up alongside the Angular
   website has been raised. That would put it behind infrastructure that already
   exists, with a team that already operates it.

3. **Whether it is public.** A public endpoint needs rate limiting, abuse
   handling, and an answer for what happens when Reactome's own services are
   slow — this server would become a new way to load them. The default binding
   makes not-public the path of least resistance, which is the right way round
   for a decision of this shape.

4. **npm publishing.** Deferred by decision, to be settled in one pass with the
   website and the other Reactome repositories rather than piecemeal.

## Why this is written down now

The factory landed for testability. Recording the rest here keeps the reason it
is shaped this way from being lost, and keeps the next person from either
building the hosting nobody agreed to or deleting the seam that makes it
possible.
