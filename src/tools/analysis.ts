import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { analysisClient } from "../clients/analysis.js";
import type {
  AnalysisResult,
  FoundElements,
  FoundEntity,
  IdentifierSummary,
  PathwaySummary,
  ResourceSummary,
  Bin,
} from "../types/index.js";

function formatPathwaySummary(pathway: PathwaySummary): string {
  return [
    `- **${pathway.name}** (${pathway.stId})`,
    `  - Entities: ${pathway.entities.found}/${pathway.entities.total} (ratio: ${pathway.entities.ratio.toFixed(3)})`,
    `  - p-value: ${pathway.entities.pValue.toExponential(2)}, FDR: ${pathway.entities.fdr.toExponential(2)}`,
    `  - Reactions: ${pathway.reactions.found}/${pathway.reactions.total}`,
  ].join("\n");
}

function formatAnalysisResult(result: AnalysisResult): string {
  const lines = [
    `## Analysis Result`,
    `**Token:** ${result.token}`,
    `**Type:** ${result.summary.type}`,
    `**Species:** ${result.summary.speciesName || result.summary.species}`,
    `**Pathways found:** ${result.pathwaysFound}`,
    result.identifiersNotFound ? `**Identifiers not found:** ${result.identifiersNotFound}` : "",
    "",
    "### Top Pathways by p-value:",
    ...result.pathways.slice(0, 15).map(formatPathwaySummary),
  ];

  if (result.pathways.length > 15) {
    lines.push("", `... and ${result.pathways.length - 15} more pathways`);
  }

  return lines.filter(Boolean).join("\n");
}

export function registerAnalysisTools(server: McpServer) {
  // Analyze single identifier
  server.tool(
    "reactome_analyze_identifier",
    "Analyze a single gene/protein identifier for pathway enrichment. Returns pathways containing this identifier.",
    {
      id: z.string().describe("Gene symbol, UniProt ID, Ensembl ID, or other identifier"),
      projection: z.boolean().optional().default(true).describe("Project results to Homo sapiens"),
      interactors: z.boolean().optional().default(false).describe("Include interactor data"),
      species: z.string().optional().describe("Filter by species (taxonomy ID or name)"),
    },
    async ({ id, projection, interactors, species }) => {
      const endpoint = projection ? `/identifier/${encodeURIComponent(id)}/projection` : `/identifier/${encodeURIComponent(id)}`;
      const result = await analysisClient.get<AnalysisResult>(endpoint, {
        interactors,
        species,
        pageSize: 20,
        sortBy: "ENTITIES_PVALUE",
        order: "ASC",
      });

      return {
        content: [{ type: "text", text: formatAnalysisResult(result) }],
      };
    }
  );

  // Batch identifier analysis (most important tool)
  server.tool(
    "reactome_analyze_identifiers",
    "Perform pathway enrichment analysis on a list of gene/protein identifiers. Returns over-represented pathways sorted by p-value.",
    {
      identifiers: z.array(z.string()).describe("List of gene symbols, UniProt IDs, or other identifiers"),
      projection: z.boolean().optional().default(true).describe("Project results to Homo sapiens"),
      interactors: z.boolean().optional().default(false).describe("Include interactor data in analysis"),
      include_disease: z.boolean().optional().default(true).describe("Include disease pathways"),
      p_value_threshold: z.number().optional().default(0.05).describe("Filter pathways by p-value threshold"),
    },
    async ({ identifiers, projection, interactors, include_disease, p_value_threshold }) => {
      const endpoint = projection ? "/identifiers/projection" : "/identifiers/";
      const result = await analysisClient.postIdentifiers<AnalysisResult>(
        endpoint,
        identifiers.join("\n"),
        {
          interactors,
          includeDisease: include_disease,
          pageSize: 50,
          sortBy: "ENTITIES_PVALUE",
          order: "ASC",
          pValue: p_value_threshold,
        }
      );

      return {
        content: [{ type: "text", text: formatAnalysisResult(result) }],
      };
    }
  );

  // Get analysis result by token
  server.tool(
    "reactome_get_analysis_result",
    "Retrieve a previously computed analysis result using its token. Allows filtering and pagination.",
    {
      token: z.string().describe("Analysis token from a previous analysis"),
      species: z.string().optional().describe("Filter by species"),
      sort_by: z.enum(["NAME", "TOTAL_ENTITIES", "FOUND_ENTITIES", "ENTITIES_PVALUE", "ENTITIES_FDR", "ENTITIES_RATIO"]).optional().default("ENTITIES_PVALUE").describe("Sort field"),
      order: z.enum(["ASC", "DESC"]).optional().default("ASC").describe("Sort order"),
      page: z.number().optional().default(1).describe("Page number"),
      page_size: z.number().optional().default(25).describe("Results per page"),
      p_value: z.number().optional().describe("Filter by p-value threshold"),
    },
    async ({ token, species, sort_by, order, page, page_size, p_value }) => {
      const result = await analysisClient.get<AnalysisResult>(`/token/${token}`, {
        species,
        sortBy: sort_by,
        order,
        page,
        pageSize: page_size,
        pValue: p_value,
      });

      return {
        content: [{ type: "text", text: formatAnalysisResult(result) }],
      };
    }
  );

  // Get found entities for a pathway
  server.tool(
    "reactome_analysis_found_entities",
    "Get the identifiers that were found in a specific pathway from an analysis result.",
    {
      token: z.string().describe("Analysis token"),
      pathway: z.string().describe("Pathway stable ID (e.g., R-HSA-109582)"),
      resource: z.string().optional().default("TOTAL").describe("Resource filter (TOTAL, UNIPROT, ENSEMBL, etc.)"),
    },
    async ({ token, pathway, resource }) => {
      const result = await analysisClient.get<FoundElements>(`/token/${token}/found/all/${pathway}`, {
        resource,
      });

      const lines = [
        `## Found Elements in ${result.pathway}`,
        `**Found entities:** ${result.foundEntities}`,
        `**Found interactors:** ${result.foundInteractors}`,
        "",
        "### Entities:",
        ...result.entities.map((e: FoundEntity) =>
          `- ${e.id} -> ${e.mapsTo.map(m => `${m.identifier} (${m.resource})`).join(", ")}`
        ),
      ];

      if (result.interactors && result.interactors.length > 0) {
        lines.push("", "### Interactors:");
        lines.push(...result.interactors.map(i => `- ${i.id}`));
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get not found identifiers
  server.tool(
    "reactome_analysis_not_found",
    "Get the list of identifiers that could not be mapped in an analysis.",
    {
      token: z.string().describe("Analysis token"),
      page: z.number().optional().default(1).describe("Page number"),
      page_size: z.number().optional().default(100).describe("Results per page"),
    },
    async ({ token, page, page_size }) => {
      const result = await analysisClient.get<IdentifierSummary[]>(`/token/${token}/notFound`, {
        page,
        pageSize: page_size,
      });

      const lines = [
        `## Not Found Identifiers`,
        `**Count:** ${result.length}`,
        "",
        ...result.map(i => `- ${i.id}`),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get resources summary
  server.tool(
    "reactome_analysis_resources",
    "Get a summary of the molecule types (resources) found in an analysis.",
    {
      token: z.string().describe("Analysis token"),
    },
    async ({ token }) => {
      const result = await analysisClient.get<ResourceSummary[]>(`/token/${token}/resources`);

      const lines = [
        `## Resource Summary`,
        "",
        "| Resource | Pathways |",
        "|----------|----------|",
        ...result.map(r => `| ${r.resource} | ${r.pathways} |`),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Compare species
  server.tool(
    "reactome_compare_species",
    "Compare Homo sapiens pathways to another species to identify orthologous pathways.",
    {
      species: z.string().describe("Species to compare (taxonomy ID or name, e.g., 'Mus musculus' or '10090')"),
      page: z.number().optional().default(1).describe("Page number"),
      page_size: z.number().optional().default(25).describe("Results per page"),
    },
    async ({ species, page, page_size }) => {
      const result = await analysisClient.get<AnalysisResult>(`/species/homoSapiens/${encodeURIComponent(species)}`, {
        page,
        pageSize: page_size,
        sortBy: "ENTITIES_PVALUE",
        order: "ASC",
      });

      return {
        content: [{ type: "text", text: formatAnalysisResult(result) }],
      };
    }
  );

  // Get pathway size distribution
  server.tool(
    "reactome_analysis_pathway_sizes",
    "Get the distribution of pathway sizes (binned) from an analysis result.",
    {
      token: z.string().describe("Analysis token"),
      bin_size: z.number().optional().default(100).describe("Bin size for grouping pathway sizes"),
      species: z.string().optional().describe("Filter by species"),
      resource: z.string().optional().default("TOTAL").describe("Resource filter"),
    },
    async ({ token, bin_size, species, resource }) => {
      const result = await analysisClient.get<Bin[]>(`/token/${token}/pathways/binned`, {
        binSize: bin_size,
        species,
        resource,
      });

      const lines = [
        `## Pathway Size Distribution`,
        "",
        "| Size Range | Count |",
        "|------------|-------|",
        ...result.map(b => `| ${b.key}-${b.key + bin_size - 1} | ${b.value} |`),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Filter analysis by pathways
  server.tool(
    "reactome_filter_analysis_pathways",
    "Filter an analysis result to only include specific pathways.",
    {
      token: z.string().describe("Analysis token"),
      pathways: z.array(z.string()).describe("List of pathway stable IDs to include"),
      resource: z.string().optional().default("TOTAL").describe("Resource filter"),
      p_value: z.number().optional().describe("p-value threshold"),
    },
    async ({ token, pathways, resource, p_value }) => {
      const result = await analysisClient.postJson<PathwaySummary[]>(
        `/token/${token}/filter/pathways`,
        pathways.join(","),
        { resource, pValue: p_value }
      );

      const lines = [
        `## Filtered Pathways`,
        `**Count:** ${result.length}`,
        "",
        ...result.map(formatPathwaySummary),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
