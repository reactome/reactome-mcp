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

export function buildServerInstructions(): string {
  // One section, unconditionally. There used to be a Cypher section appended
  // when a graph connection was configured, and it was the surface that got
  // left behind when the tools were gated -- a server describing tools it had
  // not registered. Both are gone.
  return CORE_INSTRUCTIONS;
}
