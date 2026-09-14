# 002 — Transports and hosting

**Status:** open — the design question is stated here, not settled
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

**No Neo4j from a deployed instance.** Graph tools stay behind the `NEO4J_URI`
gate, off by default, and a hosted instance does not set it. A public endpoint
holding database credentials is a different security proposition from one that
can only make the calls a browser can. A test asserts the gate holds.

**Analysis runs in the Analysis Service.** The server submits identifiers, holds
the token, and formats the reply.

## What is open

1. **Who adds Streamable HTTP, and when.** The SDK provides
   `StreamableHTTPServerTransport`. The work is small; the operational
   commitment is not.

2. **Where a hosted instance runs.** Spinning it up alongside the Angular
   website has been raised. That would put it behind infrastructure that already
   exists, with a team that already operates it.

3. **Whether it is public.** A public endpoint needs rate limiting, abuse
   handling, and an answer for what happens when Reactome's own services are
   slow — this server would become a new way to load them.

4. **npm publishing.** Deferred by decision, to be settled in one pass with the
   website and the other Reactome repositories rather than piecemeal.

## Why this is written down now

The factory landed for testability. Recording the rest here keeps the reason it
is shaped this way from being lost, and keeps the next person from either
building the hosting nobody agreed to or deleting the seam that makes it
possible.
