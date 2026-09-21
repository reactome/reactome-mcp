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

59 tools and 10 resources are registered — see [Tools](#tools) and [Resources](#resources) below for the full list. `tests/readme-tools.test.ts` fails if that count drifts or a tool goes undocumented.

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

## Resources

### Static

| URI | Description |
|-----|-------------|
| `reactome://species` | All species in Reactome |
| `reactome://species/main` | Main species with curated pathways |
| `reactome://diseases` | All annotated diseases |
| `reactome://database/info` | Database version and name |

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
