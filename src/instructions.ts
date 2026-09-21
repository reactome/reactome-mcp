import { resolveToolGroups, type ToolGroup } from "./tools/index.js";

const CORE_INSTRUCTIONS = `
This server exposes the Reactome pathway knowledgebase (https://reactome.org) to LLM clients. Reactome is a manually curated, peer-reviewed database of biological pathways: reactions grouped into pathways grouped into hierarchies, annotated with participants (proteins, complexes, small molecules), regulation, literature, species, and disease.

# Tool categories

__CATEGORY_LINES__

# Identifier conventions

- Reactome uses **stable IDs** like \`R-HSA-109582\` (species-prefixed, stable across releases) and integer **database IDs** (\`dbId\`). Most tools accept either.
- Species can be passed as a name (\`"Homo sapiens"\`) or NCBI taxonomy ID (\`"9606"\`).
- External IDs (UniProt, Ensembl, ChEBI, NCBI Gene) need a \`resource\` name plus an \`identifier\`.

# Recommended workflow

__WORKFLOW_STEPS__

# Resources (read via MCP \`resources/read\`)

__RESOURCE_LINES__
`.trim();

/**
 * Workflow steps, each tied to the group whose tools it names.
 *
 * Numbered at render time rather than in the text: a step list with a gap in
 * it, or one that cites a tool this instance withheld, is the same drift the
 * category list had. `null` means the step names no tool and always applies.
 */
const WORKFLOW_STEPS: { group: ToolGroup | null; text: string }[] = [
  {
    group: "search",
    text: "If the user gives a free-text term, call `reactome_search` first and pick the best match.",
  },
  {
    group: "pathway",
    text: "For a specific ID, use `reactome_get_pathway` (event/pathway) or `reactome_get_entity` (physical entity).",
  },
  {
    group: "pathway",
    text: "To dive into a pathway, follow up with `reactome_pathway_contained_events` and `reactome_participants`.",
  },
  {
    group: "analysis",
    text: "For enrichment analysis: `reactome_analyze_identifiers` → save the returned token → query the token-bearing endpoints.",
  },
  {
    group: null,
    text: "Pathway details often include literature references (PubMed IDs) and summations — cite these in user-facing answers.",
  },
];

/**
 * Resource lines, tied to the group that registers each URI.
 *
 * The category list and the workflow steps were made group-aware first, and
 * this was still prose -- so an instance without `analysis` withheld
 * `reactome://analysis/{token}` and then listed it here anyway. Found by
 * widening the drift test from tool names to resource URIs, which is the
 * fourth place this same divergence has turned up.
 */
const RESOURCE_LINES: { group: ToolGroup; text: string }[] = [
  {
    group: "utilities",
    text: "`reactome://species`, `reactome://species/main`, `reactome://diseases`, `reactome://database/info` — orient yourself at session start.",
  },
  { group: "pathway", text: "`reactome://pathway/{id}` — templated pathway details." },
  { group: "entity", text: "`reactome://entity/{id}` — templated entity details." },
  { group: "analysis", text: "`reactome://analysis/{token}` — templated analysis results." },
];

const CATEGORY_LINES: Record<ToolGroup, string> = {
  search: `- **Search** (\`reactome_search*\`) — full-text search across pathways, reactions, entities, genes, compounds. Start here when the user gives a free-text term.`,
  pathway: `- **Pathways** (\`reactome_get_pathway\`, \`reactome_top_pathways\`, \`reactome_pathway_ancestors\`, \`reactome_pathway_contained_events\`, \`reactome_events_hierarchy\`, \`reactome_pathways_for_entity\`) — navigate the pathway hierarchy.`,
  entity: `- **Entities** (\`reactome_get_entity\`, \`reactome_complex_subunits\`, \`reactome_participants\`, \`reactome_reference_entities\`, \`reactome_complexes_containing\`) — inspect molecular participants.`,
  analysis: `- **Analysis** (\`reactome_analyze_identifier\`, \`reactome_analyze_identifiers\`) — gene/protein-list enrichment. Returns a **token**; pass it to \`reactome_get_analysis_result\`, \`reactome_analysis_found_entities\`, etc. to read results.`,
  interactors: `- **Interactors** (\`reactome_psicquic_*\`, \`reactome_static_interactors\`, \`reactome_interactor_pathways\`) — protein–protein interaction data.`,
  export: `- **Export** (\`reactome_export_*\`) — diagrams (PNG/SVG), SBGN, SBML, PDF reports, CSV/JSON analysis exports.`,
  utilities: `- **Utilities** (\`reactome_species\`, \`reactome_diseases\`, \`reactome_database_info\`, \`reactome_mapping_*\`, \`reactome_orthology\`, \`reactome_query\`).`,
  gsa: `- **Gene set analysis** (\`reactome_gsa_*\`) — ReactomeGSA: available methods, data types, and searchable public expression datasets. Distinct from Analysis, which is over-representation on a list of identifiers.`,
};

/**
 * The instructions a client reads on connecting.
 *
 * **It describes the groups this instance actually registered, and nothing
 * else.** The last time these two facts were allowed to drift apart, the
 * server told every client to call `reactome_cypher_query` on an instance
 * that had declined to register it. That is invisible to any check which
 * asks the server what it can do, because the answer *is* the claim.
 *
 * So the category list is built from the same `ToolGroup` values that drive
 * registration, and `tests/tool-groups.test.ts` asserts a restricted
 * instance does not mention what it withheld.
 */
export function buildServerInstructions(groups: ToolGroup[] = resolveToolGroups()): string {
  const categoryLines = groups.map(group => CATEGORY_LINES[group]).join("\n");
  const steps = WORKFLOW_STEPS.filter(
    step => step.group === null || groups.includes(step.group)
  ).map((step, i) => `${i + 1}. ${step.text}`);

  const resourceLines = RESOURCE_LINES.filter(line => groups.includes(line.group)).map(
    line => `- ${line.text}`
  );

  return CORE_INSTRUCTIONS.replace("__CATEGORY_LINES__", categoryLines)
    .replace("__WORKFLOW_STEPS__", steps.join("\n"))
    .replace("__RESOURCE_LINES__", resourceLines.join("\n"));
}
