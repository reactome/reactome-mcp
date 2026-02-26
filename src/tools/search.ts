import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contentClient } from "../clients/content.js";
import type { SearchResult, SearchEntry, FacetEntry } from "../types/index.js";

interface SpellcheckResult {
  suggestions: string[];
}

interface SuggestResult {
  suggestions: string[];
}

interface PathwaySearchResult {
  dbId: number;
  stId: string;
  name: string;
  species: string;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

function formatSearchEntry(entry: SearchEntry): string {
  const name = stripHtml(entry.name);
  const lines = [
    `- **${name}** (${entry.stId})`,
    `  - Type: ${entry.exactType}`,
  ];

  if (entry.species && entry.species.length > 0) {
    lines.push(`  - Species: ${entry.species.join(", ")}`);
  }

  if (entry.referenceIdentifier) {
    lines.push(`  - Reference: ${entry.referenceIdentifier}${entry.referenceName ? ` (${entry.referenceName})` : ""}`);
  }

  if (entry.summation) {
    const summaryText = stripHtml(entry.summation);
    const summary = summaryText.length > 200 ? summaryText.substring(0, 200) + "..." : summaryText;
    lines.push(`  - ${summary}`);
  }

  return lines.join("\n");
}

function flattenSearchResults(result: SearchResult): { entries: SearchEntry[]; totalCount: number } {
  const entries: SearchEntry[] = [];
  let totalCount = 0;

  for (const group of result.results) {
    totalCount += group.entriesCount;
    entries.push(...group.entries);
  }

  return { entries, totalCount };
}

export function registerSearchTools(server: McpServer) {
  // Main search
  server.tool(
    "reactome_search",
    "Search the Reactome knowledgebase for pathways, reactions, proteins, genes, compounds, and other entities.",
    {
      query: z.string().describe("Search term (gene name, protein, pathway name, disease, etc.)"),
      species: z.string().optional().describe("Filter by species (e.g., 'Homo sapiens', 'Mus musculus')"),
      types: z.array(z.string()).optional().describe("Filter by type (Pathway, Reaction, Protein, Gene, Complex, etc.)"),
      compartments: z.array(z.string()).optional().describe("Filter by cellular compartment"),
      keywords: z.array(z.string()).optional().describe("Filter by keywords"),
      rows: z.number().optional().default(25).describe("Number of results to return"),
      cluster: z.boolean().optional().default(true).describe("Cluster related results"),
    },
    async ({ query, species, types, compartments, keywords, rows, cluster }) => {
      const params: Record<string, string | number | boolean | undefined> = {
        query,
        species,
        rows,
        cluster,
      };

      if (types && types.length > 0) {
        params.types = types.join(",");
      }
      if (compartments && compartments.length > 0) {
        params.compartments = compartments.join(",");
      }
      if (keywords && keywords.length > 0) {
        params.keywords = keywords.join(",");
      }

      const result = await contentClient.get<SearchResult>("/search/query", params);
      const { entries, totalCount } = flattenSearchResults(result);

      const lines = [
        `## Search Results for "${query}"`,
        `**Found:** ${totalCount} results`,
        "",
        ...entries.slice(0, rows).map(formatSearchEntry),
      ];

      if (totalCount > rows) {
        lines.push("", `*Showing ${Math.min(rows, entries.length)} of ${totalCount} results*`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Search with pagination
  server.tool(
    "reactome_search_paginated",
    "Search Reactome with pagination support for browsing through large result sets.",
    {
      query: z.string().describe("Search term"),
      page: z.number().optional().default(1).describe("Page number (1-based)"),
      rows_per_page: z.number().optional().default(20).describe("Results per page"),
      species: z.string().optional().describe("Filter by species"),
      types: z.array(z.string()).optional().describe("Filter by type"),
    },
    async ({ query, page, rows_per_page, species, types }) => {
      const params: Record<string, string | number | boolean | undefined> = {
        query,
        page,
        rowCount: rows_per_page,
        species,
      };

      if (types && types.length > 0) {
        params.types = types.join(",");
      }

      const result = await contentClient.get<SearchResult>("/search/query/paginated", params);
      const { entries, totalCount } = flattenSearchResults(result);

      const totalPages = Math.ceil(totalCount / rows_per_page);

      const lines = [
        `## Search Results for "${query}" (Page ${page}/${totalPages})`,
        `**Total:** ${totalCount} results`,
        "",
        ...entries.map(formatSearchEntry),
        "",
        `*Page ${page} of ${totalPages}*`,
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get search suggestions
  server.tool(
    "reactome_search_suggest",
    "Get auto-complete suggestions for a search query.",
    {
      query: z.string().describe("Partial search term"),
    },
    async ({ query }) => {
      const result = await contentClient.get<SuggestResult>("/search/suggest", { query });

      const lines = [
        `## Suggestions for "${query}"`,
        "",
        ...result.suggestions.map(s => `- ${s}`),
      ];

      if (result.suggestions.length === 0) {
        lines.push("*No suggestions found*");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Spellcheck
  server.tool(
    "reactome_search_spellcheck",
    "Get spell-check suggestions for a search query.",
    {
      query: z.string().describe("Search term to check"),
    },
    async ({ query }) => {
      const result = await contentClient.get<SpellcheckResult>("/search/spellcheck", { query });

      const lines = [
        `## Spellcheck for "${query}"`,
        "",
      ];

      if (result.suggestions && result.suggestions.length > 0) {
        lines.push("**Did you mean:**");
        lines.push(...result.suggestions.map(s => `- ${s}`));
      } else {
        lines.push("*No spelling suggestions*");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Get search facets
  server.tool(
    "reactome_search_facets",
    "Get available facets (filters) for search results, either globally or for a specific query.",
    {
      query: z.string().optional().describe("Search term (optional, returns global facets if omitted)"),
    },
    async ({ query }) => {
      interface FacetResult {
        typeFacet?: FacetEntry[];
        speciesFacet?: FacetEntry[];
        compartmentFacet?: FacetEntry[];
        keywordFacet?: FacetEntry[];
      }

      const endpoint = query ? "/search/facet_query" : "/search/facet";
      const params = query ? { query } : undefined;

      const result = await contentClient.get<FacetResult>(endpoint, params);

      const lines = [
        query ? `## Facets for "${query}"` : "## Available Search Facets",
        "",
      ];

      if (result.typeFacet && result.typeFacet.length > 0) {
        lines.push("### Types:");
        result.typeFacet.slice(0, 15).forEach(f => {
          lines.push(`- ${f.name}: ${f.count}`);
        });
        lines.push("");
      }

      if (result.speciesFacet && result.speciesFacet.length > 0) {
        lines.push("### Species:");
        result.speciesFacet.slice(0, 10).forEach(f => {
          lines.push(`- ${f.name}: ${f.count}`);
        });
        lines.push("");
      }

      if (result.compartmentFacet && result.compartmentFacet.length > 0) {
        lines.push("### Compartments:");
        result.compartmentFacet.slice(0, 10).forEach(f => {
          lines.push(`- ${f.name}: ${f.count}`);
        });
        lines.push("");
      }

      if (result.keywordFacet && result.keywordFacet.length > 0) {
        lines.push("### Keywords:");
        result.keywordFacet.slice(0, 10).forEach(f => {
          lines.push(`- ${f.name}: ${f.count}`);
        });
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Find pathways containing an entity
  server.tool(
    "reactome_search_pathways_of",
    "Find all pathways that contain a specific entity by its database ID.",
    {
      db_id: z.number().describe("Reactome database ID of the entity"),
      species: z.string().optional().describe("Filter by species"),
      include_interactors: z.boolean().optional().default(false).describe("Include interactor pathways"),
      direct_only: z.boolean().optional().default(false).describe("Only pathways where entity appears directly in diagram"),
    },
    async ({ db_id, species, include_interactors, direct_only }) => {
      const result = await contentClient.get<PathwaySearchResult[]>(`/search/pathways/of/${db_id}`, {
        species,
        includeInteractors: include_interactors,
        directlyInDiagram: direct_only,
      });

      const lines = [
        `## Pathways Containing Entity ${db_id}`,
        `**Found:** ${result.length} pathways`,
        "",
        ...result.slice(0, 50).map(p => `- **${p.name}** (${p.stId}) - ${p.species}`),
      ];

      if (result.length > 50) {
        lines.push(`... and ${result.length - 50} more pathways`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // Search within a diagram
  server.tool(
    "reactome_search_diagram",
    "Search for entities within a specific pathway diagram.",
    {
      diagram: z.string().describe("Pathway stable ID for the diagram"),
      query: z.string().describe("Search term"),
      include_interactors: z.boolean().optional().default(false).describe("Include interactors"),
    },
    async ({ diagram, query, include_interactors }) => {
      const result = await contentClient.get<SearchResult>(`/search/diagram/${encodeURIComponent(diagram)}`, {
        query,
        includeInteractors: include_interactors,
        rows: 50,
      });
      const { entries, totalCount } = flattenSearchResults(result);

      const lines = [
        `## Search in Diagram ${diagram} for "${query}"`,
        `**Found:** ${totalCount} results`,
        "",
        ...entries.map(formatSearchEntry),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
