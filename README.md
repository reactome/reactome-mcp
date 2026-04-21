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

Over 40 tools and 10 resources are registered — see [Tools](#tools) and [Resources](#resources) below for the full list. Curators can additionally opt in to direct **Cypher / Neo4j** access against a local Reactome graph database (see [Graph Database / Cypher](#graph-database--cypher-3-tools-opt-in)).

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
| `NEO4J_URI` | _(unset)_ | Set to enable the optional Cypher tools (see below). |
| `NEO4J_USER` | `neo4j` | |
| `NEO4J_PASSWORD` | `neo4j` | Works against auth-disabled local images (`reactome_neo4j_env`). Set explicitly for any remote database. |
| `NEO4J_DATABASE` | `graph.db` | Matches the default in `reactome_neo4j_env`. |
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

### Pathways (7 tools)

| Tool | Description |
|------|-------------|
| `reactome_get_pathway` | Get details of a specific pathway or reaction |
| `reactome_top_pathways` | List top-level pathways for a species |
| `reactome_pathway_ancestors` | Get the ancestor hierarchy of an event |
| `reactome_pathway_contained_events` | Get all events contained within a pathway |
| `reactome_pathways_for_entity` | Find pathways containing a specific entity |
| `reactome_diagram_pathways_for_entity` | Find diagram-level pathways containing an entity |
| `reactome_events_hierarchy` | Get the complete event hierarchy for a species |

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

### Graph Database / Cypher (3 tools, opt-in)

Only registered when `NEO4J_URI` is set. Designed for curators running the [`reactome_neo4j_env`](https://github.com/reactome/reactome_neo4j_env) Docker image locally (or pointing at a remote Reactome Neo4j). Sessions are opened in READ mode — write clauses are rejected by the server.

| Tool | Description |
|------|-------------|
| `reactome_cypher_query` | Run a read-only Cypher query with optional parameters; row count is capped |
| `reactome_cypher_schema` | Introspect labels, relationship types, and per-label property keys |
| `reactome_cypher_sample` | Return a small sample of nodes for a given label |

**Configuration** (add to your Claude MCP config `env` block):

```json
{
  "mcpServers": {
    "reactome": {
      "command": "node",
      "args": ["/absolute/path/to/reactome-mcp/dist/index.js"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "neo4j",
        "NEO4J_DATABASE": "graph.db"
      }
    }
  }
}
```

`NEO4J_USER` / `NEO4J_PASSWORD` default to `neo4j` / `neo4j` (which works when the server has auth disabled, as in `reactome_neo4j_env`). `NEO4J_DATABASE` defaults to `graph.db`.

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

## Development

```bash
npm run dev       # watch mode — recompiles on changes
npm run inspect   # interactive MCP Inspector
npm run demo      # web demo with MCP bridge
```

## License

This project is licensed under the Apache License 2.0 — see [LICENSE](LICENSE) for details.
