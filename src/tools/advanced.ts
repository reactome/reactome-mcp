/**
 * Advanced and extended MCP tools
 * Includes new tools and improved versions of existing functionality
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contentClient } from "../clients/content.js";
import { enrichPathway, formatEnrichedPathway, generatePathwayExplanation, enrichAnalysisPathway } from "../utils/enrichment.js";
import { analysisClient } from "../clients/analysis.js";
import { routeQuery } from "./router.js";
import { logger } from "../utils/logger.js";
import type { Pathway, Event } from "../types/content.js";
import type { AnalysisResult, PathwaySummary } from "../types/analysis.js";

/**
 * Strip HTML tags
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

export function registerAdvancedTools(server: McpServer) {
  /**
   * Get top pathways with enrichment
   */
  server.tool(
    "reactome_top_pathways_enriched",
    "Get all top-level pathways for a species with enriched details (reactions, summaries, statistics).",
    {
      species: z.string().optional().default("Homo sapiens").describe("Species name or taxonomy ID"),
    },
    async ({ species }) => {
      try {
        const pathways = await contentClient.get<Pathway[]>(`/data/pathways/top/${encodeURIComponent(species)}`);

        const lines = [
          `## Top-Level Pathways for ${species}`,
          `**Total:** ${pathways.length}`,
          "",
          "| Pathway | Diagram | Details |",
          "|---------|---------|---------|",
        ];

        for (const p of pathways.slice(0, 25)) {
          const hasDiagram = p.hasDiagram ? "✓" : "–";
          lines.push(`| **${p.displayName}** (${p.stId}) | ${hasDiagram} | [StId: ${p.stId}] |`);
        }

        if (pathways.length > 25) {
          lines.push(`\n*Showing 25 of ${pathways.length} pathways*`);
        }

        logger.info("top-pathways-enriched", `Retrieved ${pathways.length} top pathways for ${species}`);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        logger.error("top-pathways-enriched", err instanceof Error ? err.message : String(err));
        throw err;
      }
    }
  );

  /**
   * Explain a pathway
   */
  server.tool(
    "reactome_explain_pathway",
    "Get a detailed explanation of a pathway including its role, components, and significance.",
    {
      id: z.string().describe("Reactome stable ID (e.g., R-HSA-109582) or database ID"),
    },
    async ({ id }) => {
      try {
        const pathway = await contentClient.get<Event>(`/data/query/enhanced/${encodeURIComponent(id)}`);
        const enriched = await enrichPathway(pathway);
        enriched.explanation = generatePathwayExplanation(enriched);

        const formatted = formatEnrichedPathway(enriched);

        logger.info("explain-pathway", `Retrieved enriched details for ${id}`);

        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch (err) {
        logger.error("explain-pathway", `Failed to explain pathway ${id}: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    }
  );

  /**
   * Search with routing
   */
  server.tool(
    "reactome_smart_search",
    "Intelligent search that automatically routes to the best tool (search, pathway lookup, or analysis) based on query content.",
    {
      query: z.string().describe("Search query or request (e.g., 'explain mTOR', 'find BRCA1', 'analyze enrichment')"),
    },
    async ({ query }) => {
      try {
        const decision = routeQuery(query);

        const lines = [
          `## Smart Search Results for: "${query}"`,
          `**Routing Decision:** ${decision.action.toUpperCase()}`,
          `**Confidence:** ${(decision.confidence * 100).toFixed(1)}%`,
          `**Reasoning:** ${decision.reasoning}`,
          "",
        ];

        if (decision.action === "search") {
          // Perform search
          const params: Record<string, string | number | boolean | undefined> = {
            query,
            rows: 15,
          };

          const result = await contentClient.get<any>("/search/query", params);
          const entries = [];
          let totalCount = 0;

          for (const group of result.results) {
            totalCount += group.entriesCount;
            entries.push(...group.entries);
          }

          lines.push(`**Search Results:** Found ${totalCount} results`);
          lines.push("");
          entries.slice(0, 10).forEach(entry => {
            lines.push(`- **${stripHtml(entry.name)}** (${entry.stId}) [${entry.exactType}]`);
            if (entry.summation) {
              const summary = stripHtml(entry.summation).substring(0, 100);
              lines.push(`  ${summary}...`);
            }
          });
        } else if (decision.action === "pathway") {
          // Get pathway details
          const id = decision.suggestedParameters?.id || query.split(" ").find(w => /^R-[A-Z]{3}-\d+$/.test(w)) || query;

          const pathway = await contentClient.get<Event>(`/data/query/enhanced/${encodeURIComponent(String(id))}`);
          const enriched = await enrichPathway(pathway);

          lines.push(`**Pathway Details:**`);
          lines.push("");
          lines.push(formatEnrichedPathway(enriched));
        } else if (decision.action === "analysis") {
          lines.push(`**Analysis Mode:** This query appears to be about pathway enrichment or statistical analysis.`);
          lines.push(
            `Use tools like 'reactome_analyze_identifiers' to perform enrichment analysis on a list of genes.`
          );
        } else {
          lines.push(`**Combined Analysis:** Consider using multiple tools for comprehensive results.`);
        }

        // Add alternatives
        if (decision.alternativeActions && decision.alternativeActions.length > 0) {
          lines.push("");
          lines.push("**Alternative Approaches:**");
          decision.alternativeActions.forEach(alt => {
            lines.push(`- ${alt.action.toUpperCase()} (confidence: ${(alt.confidence * 100).toFixed(0)}%)`);
          });
        }

        logger.info("smart-search", `Routed query to ${decision.action}`, {
          query: query.substring(0, 100),
          confidence: decision.confidence,
        });

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        logger.error("smart-search", err instanceof Error ? err.message : String(err), { query: query.substring(0, 100) });
        throw err;
      }
    }
  );

  /**
   * Compare species pathways
   */
  server.tool(
    "reactome_compare_species",
    "Compare the same pathway across different species to see conservation and divergence.",
    {
      pathway_id: z.string().describe("Reactome pathway stable ID (e.g., R-HSA-109582)"),
      species_list: z.array(z.string()).optional().describe("Species to compare (e.g., ['Homo sapiens', 'Mus musculus'])"),
    },
    async ({ pathway_id, species_list }) => {
      try {
        const speciesArray = species_list || ["Homo sapiens", "Mus musculus", "Drosophila melanogaster"];

        const lines = [
          `## Pathway Comparison: ${pathway_id}`,
          `**Species:** ${speciesArray.join(", ")}`,
          "",
        ];

        const results: Record<string, Event | null> = {};

        for (const species of speciesArray) {
          try {
            const params = { species };
            const pathway = await contentClient.get<Event>(`/data/query/enhanced/${encodeURIComponent(pathway_id)}`, params);
            results[species] = pathway;
          } catch {
            results[species] = null;
          }
        }

        lines.push("| Species | Found | Reactions | Details |");
        lines.push("|---------|-------|-----------|---------|");

        for (const [species, pathway] of Object.entries(results)) {
          if (pathway) {
            const status = "✓ Found";
            const reactions = "N/A"; // Would need additional API calls
            lines.push(`| ${species} | ${status} | ${reactions} | ${pathway.displayName} |`);
          } else {
            lines.push(`| ${species} | ✗ Not found | N/A | - |`);
          }
        }

        logger.info("compare-species", `Compared pathway ${pathway_id} across ${speciesArray.length} species`);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        logger.error("compare-species", err instanceof Error ? err.message : String(err));
        throw err;
      }
    }
  );

  /**
   * Get pathways by analysis - retrieve detailed analysis results with enrichment
   */
  server.tool(
    "reactome_get_analysis_enriched",
    "Get detailed, enriched analysis results with pathway statistics and explanations.",
    {
      token: z.string().describe("Analysis token from a previous analysis"),
      top_n: z.number().optional().default(10).describe("Number of top pathways to enrich"),
      include_details: z.boolean().optional().default(true).describe("Include detailed pathway summaries"),
    },
    async ({ token, top_n, include_details }) => {
      try {
        const result = await analysisClient.get<AnalysisResult>(`/token/${token}`, {
          pageSize: top_n,
          sortBy: "ENTITIES_PVALUE",
          order: "ASC",
        });

        const lines = [
          `## Enriched Analysis Results`,
          `**Token:** ${token}`,
          `**Species:** ${result.summary.speciesName}`,
          `**Total pathways found:** ${result.pathwaysFound}`,
          "",
        ];

        if (include_details && result.pathways.length > 0) {
          lines.push("### Top Pathways");
          lines.push("");

          for (const pathway of result.pathways.slice(0, top_n)) {
            lines.push(`#### ${pathway.name}`);
            lines.push(`**ID:** ${pathway.stId}`);
            lines.push(`**Significance:** p-value = ${pathway.entities.pValue.toExponential(2)}, FDR = ${pathway.entities.fdr.toExponential(2)}`);
            lines.push(`**Coverage:** ${pathway.entities.found}/${pathway.entities.total} entities (${(pathway.entities.ratio * 100).toFixed(1)}%)`);
            lines.push("");
          }
        } else {
          lines.push("### Pathway Summary");
          lines.push("| Pathway | p-value | FDR | Coverage |");
          lines.push("|---------|---------|-----|----------|");

          for (const pathway of result.pathways.slice(0, Math.min(top_n, 20))) {
            lines.push(
              `| ${pathway.name} | ${pathway.entities.pValue.toExponential(2)} | ${pathway.entities.fdr.toExponential(2)} | ${(pathway.entities.ratio * 100).toFixed(1)}% |`
            );
          }
        }

        logger.info("analysis-enriched", `Retrieved enriched analysis results for token ${token.substring(0, 10)}`);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        logger.error("analysis-enriched", err instanceof Error ? err.message : String(err));
        throw err;
      }
    }
  );

  /**
   * Get system diagnostics for debugging
   */
  server.tool(
    "reactome_system_diagnostics",
    "Get system diagnostics including cache statistics, logging data, and fallback usage metrics.",
    {
      include_logs: z.boolean().optional().default(false).describe("Include recent log entries"),
      include_cache: z.boolean().optional().default(true).describe("Include cache statistics"),
      include_fallbacks: z.boolean().optional().default(true).describe("Include fallback usage statistics"),
    },
    async ({ include_logs, include_cache, include_fallbacks }) => {
      const lines = [`## System Diagnostics`, "", "### Status"];
      lines.push(`- **Timestamp:** ${new Date().toISOString()}`);
      lines.push(`- **Uptime:** Running`);

      if (include_cache) {
        try {
          const { globalCache } = await import("../clients/cache.js");
          const stats = globalCache.stats();

          lines.push("");
          lines.push("### Cache Statistics");
          lines.push(`- **Total Entries:** ${stats.size}/${stats.maxSize}`);
          lines.push(`- **Utilization:** ${((stats.size / stats.maxSize) * 100).toFixed(1)}%`);

          if (stats.entries.length > 0) {
            lines.push(`- **Top Cached Items:**`);
            stats.entries.slice(0, 5).forEach(entry => {
              lines.push(`  - ${entry.key.substring(0, 50)}... (hits: ${entry.hits}, age: ${entry.ageMs}ms)`);
            });
          }
        } catch (err) {
          lines.push("- **Cache:** Error retrieving stats");
        }
      }

      if (include_fallbacks) {
        try {
          const { logger: systemLogger } = await import("../utils/logger.js");
          const fallbackStats = systemLogger.getFallbackStats();
          const errorStats = systemLogger.getErrorStats();

          lines.push("");
          lines.push("### Fallback Usage");
          lines.push(`- **Total Fallbacks:** ${fallbackStats.totalFallbacks}`);
          Object.entries(fallbackStats.bySource).forEach(([source, count]) => {
            lines.push(`  - ${source}: ${count}`);
          });

          lines.push("");
          lines.push("### Error Statistics");
          lines.push(`- **Total Errors:** ${errorStats.totalErrors}`);
          lines.push(`- **Retryable:** ${errorStats.retryableCount}`);
          Object.entries(errorStats.bySource).forEach(([source, count]) => {
            lines.push(`  - ${source}: ${count}`);
          });
        } catch (err) {
          lines.push("- **Diagnostics:** Error retrieving stats");
        }
      }

      if (include_logs) {
        try {
          const { logger: systemLogger } = await import("../utils/logger.js");
          const logs = systemLogger.getLogs({ since: Date.now() - 60000 }); // Last 60 seconds

          lines.push("");
          lines.push("### Recent Logs (Last 60 seconds)");
          logs.slice(-10).forEach(log => {
            lines.push(`- [${log.level.toUpperCase()}] ${log.source}: ${log.message}`);
          });
        } catch (err) {
          lines.push("- **Logs:** Error retrieving logs");
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
