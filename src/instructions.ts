import { isNeo4jConfigured } from "./clients/neo4j.js";

const CORE_INSTRUCTIONS = `
This server exposes the Reactome pathway knowledgebase (https://reactome.org) to LLM clients. Reactome is a manually curated, peer-reviewed database of biological pathways: reactions grouped into pathways grouped into hierarchies, annotated with participants (proteins, complexes, small molecules), regulation, literature, species, and disease.

# Tool categories

- **Search** (\`reactome_search*\`) — full-text search across pathways, reactions, entities, genes, compounds. Start here when the user gives a free-text term.
- **Pathways** (\`reactome_get_pathway\`, \`reactome_top_pathways\`, \`reactome_pathway_ancestors\`, \`reactome_pathway_contained_events\`, \`reactome_events_hierarchy\`, \`reactome_pathways_for_entity\`) — navigate the pathway hierarchy.
- **Entities** (\`reactome_get_entity\`, \`reactome_complex_subunits\`, \`reactome_participants\`, \`reactome_reference_entities\`, \`reactome_complexes_containing\`) — inspect molecular participants.
- **Analysis** (\`reactome_analyze_identifier\`, \`reactome_analyze_identifiers\`) — gene/protein-list enrichment. Returns a **token**; pass it to \`reactome_get_analysis_result\`, \`reactome_analysis_found_entities\`, etc. to read results.
- **Interactors** (\`reactome_psicquic_*\`, \`reactome_static_interactors\`, \`reactome_interactor_pathways\`) — protein–protein interaction data.
- **Export** (\`reactome_export_*\`) — diagrams (PNG/SVG), SBGN, SBML, PDF reports, CSV/JSON analysis exports.
- **Utilities** (\`reactome_species\`, \`reactome_diseases\`, \`reactome_database_info\`, \`reactome_mapping_*\`, \`reactome_orthology\`, \`reactome_query\`).

# Identifier conventions

- Reactome uses **stable IDs** like \`R-HSA-109582\` (species-prefixed, stable across releases) and integer **database IDs** (\`dbId\`). Most tools accept either.
- Species can be passed as a name (\`"Homo sapiens"\`) or NCBI taxonomy ID (\`"9606"\`).
- External IDs (UniProt, Ensembl, ChEBI, NCBI Gene) need a \`resource\` name plus an \`identifier\`.

# Recommended workflow

1. If the user gives a free-text term, call \`reactome_search\` first and pick the best match.
2. For a specific ID, use \`reactome_get_pathway\` (event/pathway) or \`reactome_get_entity\` (physical entity).
3. To dive into a pathway, follow up with \`reactome_pathway_contained_events\` and \`reactome_participants\`.
4. For enrichment analysis: \`reactome_analyze_identifiers\` → save the returned token → query the token-bearing endpoints.
5. Pathway details often include literature references (PubMed IDs) and summations — cite these in user-facing answers.

# Resources (read via MCP \`resources/read\`)

- \`reactome://species\`, \`reactome://species/main\`, \`reactome://diseases\`, \`reactome://database/info\` — orient yourself at session start.
- \`reactome://pathway/{id}\`, \`reactome://entity/{id}\`, \`reactome://analysis/{token}\` — templated.
`.trim();

const CYPHER_INSTRUCTIONS = `
# Graph database (Cypher) — enabled

A local Neo4j Reactome graph is available. Use it when the user wants a query that the REST API does not expose — e.g. arbitrary graph traversals, complex relational joins, aggregate counts across labels.

**Workflow for Cypher:**

1. Call \`reactome_cypher_schema\` (or read the \`reactome://graph/schema\` resource) **before writing any query** to learn the live labels, relationship types, and properties. Never guess the schema.
2. Use \`reactome_cypher_sample\` on a label to see a representative node's shape.
3. Write a Cypher query with \`reactome_cypher_query\`. Rules:
   - Sessions run in READ mode; write clauses will be rejected.
   - APOC procedures that can write (\`apoc.cypher.runWrite\`, \`apoc.periodic.*\`, \`apoc.create/merge/refactor.*\`, \`apoc.load/import/export.*\`, \`apoc.trigger.*\`, \`apoc.nodes.delete\`) are pre-rejected — don't try them.
   - Always include a \`LIMIT\`. The tool caps rows, row width, and total response size, but short queries are faster and cheaper.
   - Project specific fields (\`RETURN n.stId, n.displayName\`) rather than whole nodes when you don't need every property.

**When NOT to use Cypher:** for lookups by ID or name, pathway hierarchies, or enrichment — the REST tools are faster, cached, and do the formatting for you.
`.trim();

export function buildServerInstructions(): string {
  const parts = [CORE_INSTRUCTIONS];
  if (isNeo4jConfigured()) parts.push(CYPHER_INSTRUCTIONS);
  return parts.join("\n\n");
}
