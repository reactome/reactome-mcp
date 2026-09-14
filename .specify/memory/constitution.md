<!--
Sync Impact Report
==================
Version: none -> 1.0.0  (initial ratification)

Added:    Principles I-VII, Scope boundaries, Development workflow, Governance
Modified: none
Removed:  none

Rationale: first constitution for this repository. The principles are not
aspirational -- each one is written from a failure this repo actually had, or a
boundary the Reactome team has already decided. Sources are named inline so a
future reader can check whether the reason still holds.

Follow-up TODOs: none.
-->

# Reactome MCP Server Constitution

This server is how agents reach Reactome. It is cloned directly by people who
then point an agent at it, so its failures are not contained — they surface as
confident, wrong answers about biology. These principles exist to make that
unlikely.

## Core Principles

### I. A type assertion is not a verification

`contentClient.get<T>(...)` tells TypeScript what to believe. It does not check.
Nine tools once called the right endpoint, returned success, and rendered
`undefined` — or rendered nothing at all — because the declared shape was
invented rather than observed.

Every response type must be derived from a real response. Record the endpoint
and a trimmed payload in a comment above the type, and pin the formatter with a
test built from that same payload. When a fixture stops matching production,
that is a signal to change the formatter, not the fixture.

### II. Silence is the dangerous failure, not the crash

A crash gets reported. A tool that renders its heading and nothing else gets
believed. `search_facets` returned an empty section list for months because each
facet is an object with an `available` array and `.length` on it was `undefined`
— falsy, so every section was skipped, successfully.

Grepping output for `undefined` cannot find a field that was dropped cleanly.
Review a tool's rendered output against the real payload and ask what is
*missing*, not only what is malformed. A formatter that can produce an empty body
must say so explicitly.

### III. Exercise tools against the live services

Unit tests with fixtures pin known shapes. They cannot discover that an endpoint
changed, that a default argument produces HTTP 500, or that a tool nobody calls
has never worked. `events_hierarchy` defaulted to species `"Homo sapiens"`, which
that endpoint answers with 500; `"9606"` returns 200.

A sweep that calls every reachable tool against the live services belongs in the
release path. Tools unreachable without a token or an unguessable ID are where
bugs accumulate — all seven analysis tools were untested when a token-parsing bug
shipped.

### IV. Reactome data, through the public services

Tools read the Content Service and the Analysis Service over HTTP. The server
does not hold a Neo4j connection in any deployment the team runs: graph tools stay
behind the `NEO4J_URI` gate and stay off by default.

This is a decision about blast radius, not capability. A public MCP endpoint with
database credentials is a different security proposition from one that can only
make the same calls a browser can.

### V. Analysis runs in the service, not in the agent

Over-representation analysis, species comparison and pathway filtering are
Analysis Service operations. The server submits identifiers, holds the token, and
formats what comes back. It does not reimplement the statistics, and it does not
ask the model to do arithmetic on pathway counts.

### VI. Every tool is a prompt

Tool names, descriptions and parameter docs are the entire interface a model
reasons over. A misleading description is a defect of the same severity as a
misread field — it causes the wrong tool to be called and the wrong answer to be
given, with nothing in the logs to show for it.

Descriptions state what the tool returns and what it costs. Where an argument has
a form that works and a form that does not, say which.

### VII. Match the house, then improve it

Fixes to existing tools follow the surrounding idiom. Where four tools share one
response envelope, they share one type and one formatter — four private copies is
how three of them came to be wrong in the same way.

Broad reformatting rides with substantive change or not at all; a diff that mixes
them cannot be reviewed.

## Scope boundaries

**In scope.** Content Service and Analysis Service coverage, response formatting
for model consumption, transports (stdio today; Streamable HTTP is the open
question for hosted use), and the tests and sweeps that keep the above honest.

**Out of scope by decision, not by oversight.** Direct Neo4j access from any
deployed instance (Principle IV). Reimplementing analysis (Principle V).
Non-Reactome data sources — the chatbot's cascade reaches Tavily and external
search, and that logic belongs in the chatbot, not here.

**Deferred with intent.** npm publishing is planned but will be settled alongside
the website and the other Reactome repos, in one pass rather than piecemeal.

## Development workflow

Changes land through pull requests against `main`. CI runs the build, the
typecheck and the full test suite on every supported Node version; a red CI is
not a thing to be merged past. CI was red for roughly five months because the
lockfile referenced a dependency that was never added — the cost of that was not
the broken build, it was that nobody could tell the difference between a new
failure and the standing one.

Dependency bumps that change a major version are evaluated, not merged on the
strength of a green check: the test suite does not cover most tools, so green
means less here than it looks.

Community contributions are read for what is valuable in them. Where a
contributor already fixed something, the fix is taken and credited rather than
re-derived.

## Governance

This constitution records decisions that outlive the conversation that produced
them. It is not a style guide and it is not exhaustive.

A principle may be overridden. The override is recorded — in the pull request
that takes it, and here if it holds generally — with the reason and what would
reverse it. An undocumented override is the failure mode this file exists to
prevent, because the next reader cannot tell a decision from an accident.

Amendments bump the version: MAJOR for a principle removed or redefined, MINOR
for one added, PATCH for wording. Specs live in `specs/`; the ones that record
why something is the way it is are as valuable as the ones that plan what is next.

**Version**: 1.0.0 | **Ratified**: 2026-09-14 | **Last amended**: 2026-09-14
