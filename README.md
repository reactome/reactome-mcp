# reactome-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes the [Reactome](https://reactome.org/) pathway knowledgebase to AI assistants. It wraps Reactome's Content Service and Analysis Service REST APIs, giving LLMs the ability to search, browse, analyse, and export biological pathway data through natural language.

## Features

- **Pathway enrichment analysis** — submit gene/protein lists and retrieve over-representation results, including p-values, FDR, and found/not-found identifiers
- **Search** — full-text search across pathways, reactions, proteins, genes, and compounds with faceting, pagination, autocomplete, and spellcheck
- **Pathway browsing** — navigate the pathway hierarchy, retrieve event details, ancestors, contained events, and participants
- **Entity lookup** — inspect physical entities, complexes, subunits, and cross-references
- **Interactors** — query protein–protein interaction data from PSICQUIC resources and Reactome's curated interactor database
- **Export** — diagrams (PNG/SVG/JPG/GIF), SBGN, SBML, PDF reports, and CSV/JSON analysis results
- **Species & disease** — list available species and disease annotations
- **ID mapping** — map external identifiers (UniProt, Ensembl, CHEBI, etc.) to Reactome pathways and reactions

59 tools and 10 resources are registered by default — see [Tools](#tools) and [Resources](#resources) below for the full list. An internal instance can additionally be given read-only Cypher access to a Reactome graph database, which makes 62 with graph access and 11 resources; it is **off** unless two variables are set, and a public instance must never set them (see [Graph database access](#graph-database-access-internal-instances-only)). `tests/readme-tools.test.ts` fails if those counts drift or a tool goes undocumented.

## Prerequisites

- Node.js >= 18

## Installation

```bash
git clone https://github.com/reactome/reactome-mcp.git
cd reactome-mcp
npm install  # runs `prepare` which builds dist/
```

## Configuration

All configuration is via environment variables — pass them in the `env` block of your MCP client config.

| Variable | Default | Purpose |
|---|---|---|
| `REACTOME_BASE_URL` | `https://reactome.org` | Base URL for the Content + Analysis Services. Override to point at staging / a specific release host. |
| `REACTOME_CONTENT_SERVICE_URL` | derived from `REACTOME_BASE_URL` | Fine-grained override for the Content Service only. |
| `REACTOME_ANALYSIS_SERVICE_URL` | derived from `REACTOME_BASE_URL` | Fine-grained override for the Analysis Service only. |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`. Logs are JSON on stderr; stdout is reserved for the MCP protocol. |

## Choosing which tools to publish

All 59 tools register by default, which is what you want locally. A hosted
instance usually wants fewer, so `MCP_TOOL_GROUPS` selects groups:

```
MCP_TOOL_GROUPS=search,pathway,entity,utilities,analysis
```

| Group | Tools |
|-------|-------|
| `search` | 7 |
| `pathway` | 8 |
| `entity` | 8 |
| `analysis` | 9 |
| `export` | 9 |
| `interactors` | 6 |
| `gsa` | 5 |
| `utilities` | 7 |
| `cypher` | 3 — only with [graph database access](#graph-database-access-internal-instances-only) on |

This is a **registration** switch, not a documentation one. An omitted group's
tools are not registered, are not listed by `tools/list`, and are not
mentioned in the instructions the server sends on connection — and **nor are
its resources**: omitting `analysis` withholds `reactome://analysis/{token}`
too, because a capability moved to a URI is not a capability withheld. A tool
described nowhere but still answering is the failure this avoids.

Three cases behave differently on purpose, because the dangerous one is a
restriction that quietly becomes "everything":

- **unset** — all groups (`cypher` only if graph database access is on)
- **set and empty** — the server refuses to start
- **set with an unknown name** — the server refuses to start, naming the typo
- **names `cypher` while graph database access is off** — the server refuses to start, rather than quietly serving without it

## Graph database access (internal instances only)

Three extra tools — `reactome_cypher_schema`, `reactome_cypher_sample` and
`reactome_cypher_query` — and the `reactome://graph/schema` resource let an
agent query a Reactome Neo4j graph database directly. They exist for internal
instances pointed at a **dedicated** graph database container.

**They are off by default, and a publicly reachable instance must never turn
them on.** An arbitrary Cypher query can run for a long time and hold the
database's memory and CPU while it does; on a public endpoint that is a way for
anyone on the internet to degrade the database and whatever else depends on it.
The read-only safeguards below limit the damage a query can do to the data, not
the load it can put on the server.

Graph access exists only when **both** of these are set:

| Variable | Value | |
|---|---|---|
| `NEO4J_URI` | e.g. `bolt://127.0.0.1:7687` | where the graph database listens |
| `MCP_ALLOW_CYPHER` | exactly `1` | the explicit opt-in; any other value is off |

Either one alone does nothing: no tools, no schema resource, no mention in the
instructions the server sends on connection, and no database connection is
ever opened. `NEO4J_URI` alone is deliberately not enough — a connection string
is easy to inherit from a shared environment and is not a decision to publish
query access. The same check guards every surface (tool registration, the
resource, the instructions, the startup schema warm-up) and the driver factory
itself, in both the stdio and the HTTP entrypoints;
`tests/graph-access-gate.test.ts` drives each of them in every combination of
the two variables. `GET /health` on the HTTP transport reports `graphAccess`.

Optional:

| Variable | Default | |
|---|---|---|
| `NEO4J_USER` | `neo4j` | used only when `NEO4J_PASSWORD` is set |
| `NEO4J_PASSWORD` | _(unset)_ | unset connects without credentials, for a database with authentication disabled |
| `NEO4J_DATABASE` | _(server default)_ | Neo4j Community serves a single database, so this is rarely needed |
| `CYPHER_QUERY_TIMEOUT_MS` | `30000` | server-side transaction timeout for `reactome_cypher_*` queries |
| `NEO4J_SCHEMA_FILE` | _(unset)_ | a schema saved by [`extract-schema`](#saving-the-schema-extract-schema), served instead of extracting one when it matches the database; ignored entirely while graph access is off |

**Read-only safeguards.** Every query runs in a READ-mode session, so the
database refuses `CREATE`, `MERGE`, `DELETE`, `SET` and `REMOVE`. Before a
query reaches the database it is checked against an allowlist: `CALL` only for
the built-in schema procedures (`db.labels`, `db.relationshipTypes`,
`db.propertyKeys`, `db.schema.*`, `db.indexes`, `db.constraints`,
`dbms.components`) and the fulltext query procedures
(`db.index.fulltext.queryNodes`, `db.index.fulltext.queryRelationships`), no
`CALL { ... }` subqueries, `SHOW` only for indexes and constraints, and no
APOC or GDS name, `LOAD CSV`, `USE`, `TERMINATE`, `CYPHER` options prefix
(version, planner, runtime) or write/admin clause. `SET`, `SHOW` and `CYPHER`
cannot be used as variable names. The check runs on the query as Neo4j tokenises
it (comments, string literals and quoted names read as such), and anything it
cannot finish reading is refused. Each query runs under a server-side timeout;
rows are streamed and reading stops at `max_rows`, with the rest discarded on
the server, and row width and total response size are capped. These are
guardrails; the boundary is that graph access is not enabled where the public
can reach it.

### Running against the Reactome graph database container

Reactome publishes its graph database as an image. Run it bound to loopback, so
nothing but processes on the same machine can reach it:

```bash
docker run -d --name reactome-graphdb \
  -p 127.0.0.1:7687:7687 \
  public.ecr.aws/reactome/graphdb:Release97
```

Then point an internal instance at it:

```bash
NEO4J_URI=bolt://127.0.0.1:7687 MCP_ALLOW_CYPHER=1 node dist/index.js
```

Add `NEO4J_USER` / `NEO4J_PASSWORD` if the container is configured with
authentication. The server reads the schema with Neo4j's built-in procedures
(`db.schema.nodeTypeProperties()`, `db.schema.relTypeProperties()`,
`db.schema.visualization()`, `SHOW INDEXES`, `SHOW CONSTRAINTS`), so APOC is not
required — the Reactome image runs Neo4j 4.4 Community without it. The schema
is read once in the background at startup and cached; on the full graph that
can take a while, and a section the database cannot provide is reported as
unavailable rather than shown empty.

### Saving the schema: `extract-schema`

Reading the schema of the full Reactome graph takes about a minute. To skip
that at startup, save it once and point the server at the file:

```bash
NEO4J_PASSWORD=… node dist/index.js extract-schema \
  --uri bolt://127.0.0.1:7687 --out reactome-schema.json
# installed from npm: npx reactome-mcp extract-schema …

NEO4J_URI=bolt://127.0.0.1:7687 MCP_ALLOW_CYPHER=1 \
  NEO4J_SCHEMA_FILE=reactome-schema.json node dist/index.js
```

| Option | |
|---|---|
| `--uri <uri>` | the database (required) |
| `--database <name>` | default `NEO4J_DATABASE`, else the server's default database |
| `--user <name>` | default `NEO4J_USER`, else `neo4j` |
| `--password-env <VAR>` | read the password from `VAR` instead of `NEO4J_PASSWORD` |
| `--out <file>` | write here; without it the JSON goes to stdout |

There is no `--password`, and passing one is refused: a command line is visible
to every user of the machine in `ps`. The password comes from the environment.

`extract-schema` runs the server's own extractor, read-only and under the same
timeouts, so the file has exactly the structure of the `reactome://graph/schema`
resource. It does not need `MCP_ALLOW_CYPHER` — it is a command an operator runs
by hand, not a server, and it publishes nothing. It refuses to write a schema
with sections it could not read, since a saved schema would keep that gap for as
long as it is used, or one whose body disagrees with its own fingerprint, which
means the database was written to during the run. Usage errors name the flag at
most and never echo a value.

**The file is only served against the database it came from.** Every schema
carries a `schemaFormat` number (currently `2`) and a `source` fingerprint:

- Neo4j version and edition, and the name of the database actually connected to
- the Reactome release from the graph's `DBInfo` node (absent on a graph without one)
- total node and relationship counts
- digests of the label, relationship type and property key lists, and of the
  indexes (name, labels, properties, state) and constraints
- when it was taken (recorded, not compared)

On its first schema request the server reads the same fingerprint from the live
database — metadata procedures and count-store lookups, nothing that scans the
nodes or their properties, rather than the full extraction — and serves the
file only if every field agrees, the format is one it reads, and the file agrees
with its own fingerprint. When it does, it logs `graph schema served from file`
with the file, release and database. Otherwise it logs a warning naming the
difference and extracts the schema live, as if no file were set. With graph
access off, `NEO4J_SCHEMA_FILE` is not read at all.

| Detected (the file is not used) | Not detected (the file is still used) |
|---|---|
| another release, database or Neo4j version | a property's value changing |
| a node or relationship added or removed | a property's value type changing (say, a string becoming a list) |
| a new label, relationship type or property key (`SET n.newProp`) | an existing property key set on nodes that lacked it |
| an index or constraint created, dropped or no longer online | one node deleted and another added with the same labels, keys and totals |
| an older format, or a missing, malformed or self-contradictory file | a property key no longer used anywhere — Neo4j keeps key tokens once created |

So a snapshot is safe against a different database and against most structural
edits, but it is a fingerprint, not a proof: after edits that only change
values, re-run `extract-schema` or unset `NEO4J_SCHEMA_FILE`.

**From the release pipeline.** Once a release's graph database image is built,
the same command against a container started from it produces a schema that can
be published beside the image as an optional artifact:

```bash
docker run -d --name graphdb-schema -p 127.0.0.1:7687:7687 <the new graph database image>
node dist/index.js extract-schema --uri bolt://127.0.0.1:7687 \
  --out reactome-<release>-schema.json
docker rm -f graphdb-schema
```

An instance run against that image can then set `NEO4J_SCHEMA_FILE` to the
published file; one run against anything else will fall back to live extraction
on its own.

### Pointing at your own database

A curator, or anyone with a Reactome-shaped graph of their own, can run an
internal instance against it. The same rule applies as everywhere else here:
**only on an instance that is not publicly reachable** — on your own machine
over stdio, or bound to loopback.

```bash
NEO4J_URI=bolt://127.0.0.1:7687 \
NEO4J_USER=neo4j NEO4J_PASSWORD=… \
NEO4J_DATABASE=<your database, if not the default> \
MCP_ALLOW_CYPHER=1 \
node dist/index.js
```

Nothing else is needed: the schema the Cypher tools describe is read from your
database at startup, not shipped with the server, so it reflects your labels,
properties and counts. A database without a `DBInfo` node is fine; the schema
simply names no release.

To skip the extraction on later starts, save your database's schema with
`extract-schema` and set `NEO4J_SCHEMA_FILE` to it. The fingerprint check is
what makes this safe to get wrong: a schema saved from the release graph will
not match your database, so it is not used against it, and nor is your own
snapshot once your database has changed in a way the fingerprint sees — a node
or relationship added or removed, a new label, relationship type or property
key, an index or constraint changed. In those cases the server warns and reads
the schema live. Edits that only change property values or their types are
**not** seen (see the table above); after those, re-run `extract-schema`.

## Usage

### With Claude Desktop

Add the server to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "reactome": {
      "command": "node",
      "args": ["/absolute/path/to/reactome-mcp/dist/index.js"]
    }
  }
}
```

### With Claude Code

```bash
claude mcp add reactome node /absolute/path/to/reactome-mcp/dist/index.js
```

### Example prompts

Once the server is registered, try asking Claude:

**Exploration (REST — works with default install):**

- "What does Reactome know about the TP53 gene? Show me the top pathways it appears in."
- "Give me the top-level pathways for *Mus musculus* and point out which are disease pathways."
- "Summarize pathway R-HSA-109582 — include the references."
- "I have these UniProt IDs: P04637, P53350, Q9UPN9, Q9Y243. Run a Reactome pathway enrichment and list the top 10 hits by FDR."
- "Find pathways in the HHV8 infection area and show me the contained reactions of the best match."
- "Export the SBGN for pathway R-HSA-1640170."

Claude reads per-server instructions on connection explaining the tool categories, ID conventions, and a recommended workflow, so it can usually chain the right calls without hand-holding. If an answer looks off, ask it to "show me the tool call and its result" and correct from there.

### Standalone

```bash
npm start
```

The server communicates over stdio using the MCP protocol.

### MCP Inspector

```bash
npm run inspect
```

Opens the [MCP Inspector](https://github.com/anthropics/mcp-inspector) UI for interactive testing.

### Web Demo

```bash
npm run demo
```

Starts a local web UI with an MCP bridge for browser-based exploration.

## Tools

### Analysis (9 tools)

| Tool | Description |
|------|-------------|
| `reactome_analyze_identifier` | Analyse a single gene/protein identifier for pathway enrichment |
| `reactome_analyze_identifiers` | Pathway enrichment analysis on a list of identifiers |
| `reactome_get_analysis_result` | Retrieve a previously computed analysis result by token |
| `reactome_analysis_found_entities` | Get identifiers found in a specific pathway from an analysis |
| `reactome_analysis_not_found` | Get identifiers that could not be mapped in an analysis |
| `reactome_analysis_resources` | Get a summary of molecule types found in an analysis |
| `reactome_compare_species` | Compare Homo sapiens pathways to another species |
| `reactome_analysis_pathway_sizes` | Get pathway size distribution from an analysis result |
| `reactome_filter_analysis_pathways` | Filter an analysis result to specific pathways |

### Pathways (8 tools)

| Tool | Description |
|------|-------------|
| `reactome_get_pathway` | Get details of a specific pathway or reaction |
| `reactome_top_pathways` | List top-level pathways for a species |
| `reactome_pathway_ancestors` | Get the ancestor hierarchy of an event |
| `reactome_pathway_contained_events` | Get all events contained within a pathway |
| `reactome_pathways_for_entity` | Find pathways containing a specific entity |
| `reactome_diagram_pathways_for_entity` | Find diagram-level pathways containing an entity |
| `reactome_events_hierarchy` | Get the complete event hierarchy for a species |
| `reactome_preceding_events` | Find the events that must occur before a reaction or pathway — Reactome's event ordering |

### Search (7 tools)

| Tool | Description |
|------|-------------|
| `reactome_search` | Full-text search across the knowledgebase |
| `reactome_search_paginated` | Search with pagination |
| `reactome_search_suggest` | Autocomplete suggestions |
| `reactome_search_spellcheck` | Spell-check suggestions |
| `reactome_search_facets` | Get available search facets/filters |
| `reactome_search_pathways_of` | Find pathways containing an entity by database ID |
| `reactome_search_diagram` | Search for entities within a pathway diagram |

### Entities (8 tools)

| Tool | Description |
|------|-------------|
| `reactome_get_entity` | Get details of a physical entity |
| `reactome_complex_subunits` | Get all subunits of a complex |
| `reactome_entity_other_forms` | Get other forms of a physical entity |
| `reactome_entity_component_of` | Find larger structures containing an entity |
| `reactome_participants` | Get molecular participants in a reaction or pathway |
| `reactome_participating_physical_entities` | Get physical entities participating in an event |
| `reactome_reference_entities` | Get reference entities for event participants |
| `reactome_complexes_containing` | Find complexes containing an external identifier |

### Export (9 tools)

| Tool | Description |
|------|-------------|
| `reactome_export_diagram` | Export a pathway diagram as an image |
| `reactome_export_reaction` | Export a reaction diagram as an image |
| `reactome_export_fireworks` | Export the species pathway overview diagram |
| `reactome_export_sbgn` | Export to SBGN XML |
| `reactome_export_sbml` | Export to SBML |
| `reactome_export_pdf` | Export documentation to PDF |
| `reactome_export_analysis_report` | Generate a PDF analysis report |
| `reactome_export_analysis_csv` | Export analysis results as CSV |
| `reactome_export_analysis_json` | Export analysis results as JSON |

### Interactors (6 tools)

| Tool | Description |
|------|-------------|
| `reactome_psicquic_resources` | List available PSICQUIC interaction databases |
| `reactome_psicquic_summary` | Summarise interactions from a PSICQUIC resource |
| `reactome_psicquic_details` | Get detailed interactions from a PSICQUIC resource |
| `reactome_static_interactors` | Get curated interactions from Reactome |
| `reactome_interactor_pathways` | Find pathways where a protein's interactors appear |
| `reactome_interactor_summary` | Summarise curated interactions for a protein |

### Gene Set Analysis / ReactomeGSA (5 tools)

| Tool | Description |
|------|-------------|
| `reactome_gsa_methods` | List the gene set analysis methods ReactomeGSA offers (PADOG, Camera, ssGSEA, terapadog) |
| `reactome_gsa_data_types` | List the kinds of experimental data ReactomeGSA can analyse (RNA-seq counts, normalised RNA-seq, proteomics, microarray, Ribo-seq) |
| `reactome_gsa_search_datasets` | Search public expression datasets ReactomeGSA can load — Expression Atlas, Single Cell Expression Atlas, GREIN, GEO |
| `reactome_gsa_examples` | List the bundled example datasets |
| `reactome_gsa_sources` | List the external dataset sources ReactomeGSA can load from |

### Utilities (7 tools)

| Tool | Description |
|------|-------------|
| `reactome_species` | List species available in Reactome |
| `reactome_diseases` | List diseases annotated in Reactome |
| `reactome_database_info` | Get database version information |
| `reactome_mapping_pathways` | Map an external identifier to pathways |
| `reactome_mapping_reactions` | Map an external identifier to reactions |
| `reactome_orthology` | Get orthologous events/entities in another species |
| `reactome_query` | Query any Reactome database object by identifier |

### Graph database / Cypher (3 tools — internal instances only)

Registered only when `NEO4J_URI` and `MCP_ALLOW_CYPHER=1` are both set; see
[Graph database access](#graph-database-access-internal-instances-only).

| Tool | Description |
|------|-------------|
| `reactome_cypher_schema` | Labels, relationship types, connecting patterns, properties, indexes and constraints of the graph |
| `reactome_cypher_sample` | A few nodes of one label, to see their shape |
| `reactome_cypher_query` | Run a read-only Cypher query (READ session, timeout, capped output) |

## Resources

### Static

| URI | Description |
|-----|-------------|
| `reactome://species` | All species in Reactome |
| `reactome://species/main` | Main species with curated pathways |
| `reactome://diseases` | All annotated diseases |
| `reactome://database/info` | Database version and name |
| `reactome://graph/schema` | Graph database schema as JSON — only with graph database access on |

### Templates

| URI Template | Description |
|--------------|-------------|
| `reactome://pathway/{id}` | Pathway details |
| `reactome://pathway/{id}/diagram` | Pathway diagram (SVG) |
| `reactome://entity/{id}` | Entity details |
| `reactome://analysis/{token}` | Analysis result |
| `reactome://top-pathways/{species}` | Top-level pathways for a species |
| `reactome://events-hierarchy/{species}` | Full event hierarchy for a species |

## Transports

**stdio** is the default and the one every existing client uses:

```bash
node dist/index.js
```

**Streamable HTTP** is for a hosted instance, because a reverse proxy cannot
front a process that talks over stdin/stdout:

```bash
MCP_HTTP_PORT=4320 node dist/http-server.js
# or: MCP_HTTP_PORT=4320 npm run start:http
```

| variable | default | |
|---|---|---|
| `MCP_HTTP_PORT` | *(unset)* | required to serve HTTP |
| `MCP_HTTP_HOST` | `127.0.0.1` | see below before changing |
| `MCP_SESSION_TTL_MS` | `1800000` | idle session reaped after 30 min |
| `MCP_MAX_SESSIONS` | `256` | concurrent session ceiling |

A hosted instance must leave `NEO4J_URI` and `MCP_ALLOW_CYPHER` unset; see
[Graph database access](#graph-database-access-internal-instances-only).

Endpoints: `POST /mcp` (initialize, then requests), `GET /mcp` (server stream),
`DELETE /mcp` (end session), `GET /health`.

Each session gets its **own** server instance, so two clients cannot interleave
on shared state. Idle sessions are reaped and the session count is capped, so a
client that never sends `DELETE` cannot accumulate servers until the process
dies.

### Why it binds to loopback

`MCP_HTTP_HOST` defaults to `127.0.0.1`, and that is a deliberate default rather
than a placeholder. The Reactome site already learned this the expensive way:
crawlers on the public `/ContentService/exporter/*` URLs exhausted Tomcat's heap
and took the origin down, which is why the sibling render service on that box
binds loopback only and is reached through the site's own origin.

An MCP endpoint is the same shape of risk and worse per request —
`reactome_analyze_identifiers` submits a real job to the Analysis Service. Put
it behind something that rate-limits before binding it anywhere else.

When the host is a loopback address the SDK also turns on DNS-rebinding
protection, which is what stops a page in someone's browser from driving a
server bound to their own machine. Binding to `0.0.0.0` turns that off.

## Development

```bash
npm run check     # lint, format, typecheck (both compilers), build, test
npm run dev       # watch mode — recompiles on changes
npm test          # unit tests
npm run sweep     # call all 53 tools against the live Reactome services
npm run inspect   # interactive MCP Inspector
npm run demo      # web demo with MCP bridge
```

`npm run sweep` needs the network and hits production Reactome. It is not part
of `npm test`; run it before a release and after touching any formatter. Unit
tests pin shapes we already know about — only the sweep finds a tool that has
never worked.

### Two TypeScript versions, on purpose

The build and typecheck run **TypeScript 7**; the package named `typescript` is
pinned to **6.0.3** because that is what typescript-eslint supports
([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).
TypeScript 7 is installed under the alias `typescript-7`. This is the
[side-by-side arrangement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)
the TypeScript team documents.

**Scripts name the compiler by path rather than calling `tsc`.** Both packages
ship a `tsc` binary, so `node_modules/.bin/tsc` points at whichever npm linked
last — observed as 7.0.2 after an incremental install and 6.0.3 after a clean
`npm ci` on the same tree. A bare `tsc` would silently compile with a different
compiler depending on how the tree was installed.

`npm run check` typechecks with **both**, so a disagreement between them shows
up as a failed check rather than as lint and build quietly diverging.

When typescript-eslint supports TypeScript 7, drop the alias, move `typescript`
to 7, and point the scripts back at `tsc`. Tracked in
[#29](https://github.com/reactome/reactome-mcp/issues/29).

## License

This project is licensed under the Apache License 2.0 — see [LICENSE](LICENSE) for details.
