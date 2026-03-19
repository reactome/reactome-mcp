import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contentClient } from "../clients/content.js";
import type { SearchResult, Event, Pathway } from "../types/index.js";

/**
 * Strip HTML tags from search result text.
 */
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

/**
 * Search Reactome, fetch details for the top result, and build
 * a human-readable explanation entirely from the Reactome data.
 * No external LLM API required.
 */
async function buildExplanation(
  query: string,
  detailLevel: "brief" | "standard" | "detailed"
): Promise<string> {
  // Step 1: Search Reactome
  const searchResult = await contentClient.get<SearchResult>("/search/query", {
    query,
    rows: 10,
    cluster: true,
  });

  const entries = searchResult.results.flatMap((group) => group.entries);

  if (entries.length === 0) {
    return [
      `## No Results Found`,
      "",
      `Reactome has no entries matching **"${query}"**.`,
      "",
      "**Tips:**",
      "- Try a gene symbol like `TP53` instead of a full name",
      "- Try a pathway name like `apoptosis` or `cell cycle`",
      "- Check spelling with the `reactome_search_spellcheck` tool",
    ].join("\n");
  }

  const lines: string[] = [];
  const topEntry = entries[0];

  // Step 2: Fetch detailed info for the top result
  let detailed: Event | null = null;
  if (topEntry.stId) {
    try {
      detailed = await contentClient.get<Event>(
        `/data/query/enhanced/${encodeURIComponent(topEntry.stId)}`
      );
    } catch {
      // If detailed fetch fails, continue with search data only
    }
  }

  // Step 3: Build the explanation header
  const name = detailed?.displayName || stripHtml(topEntry.name);
  lines.push(`## ${name}`);
  lines.push("");

  // Basic metadata
  if (detailed) {
    lines.push(`| Property | Value |`);
    lines.push(`|----------|-------|`);
    lines.push(`| **Reactome ID** | ${detailed.stId} |`);
    lines.push(`| **Type** | ${detailed.schemaClass} |`);
    if (detailed.speciesName) {
      lines.push(`| **Species** | ${detailed.speciesName} |`);
    }
    if (detailed.isInDisease) {
      lines.push(`| **Disease pathway** | Yes |`);
    }
    if (detailed.hasDiagram) {
      lines.push(`| **Has diagram** | Yes |`);
    }
    lines.push("");
  }

  // Step 4: Add the summary/description
  if (detailed?.summation && detailed.summation.length > 0) {
    const fullSummary = detailed.summation[0].text;
    // Strip HTML from summation text
    const cleanSummary = stripHtml(fullSummary);

    if (detailLevel === "brief") {
      // Just first 2 sentences
      const sentences = cleanSummary.match(/[^.!?]+[.!?]+/g) || [cleanSummary];
      lines.push("### Summary");
      lines.push(sentences.slice(0, 2).join(" ").trim());
    } else {
      lines.push("### Description");
      lines.push(cleanSummary);
    }
    lines.push("");
  }

  // Step 5: For standard/detailed — fetch sub-pathways and participants
  if (detailLevel !== "brief" && detailed?.stId) {
    // Try to get contained events (sub-pathways and reactions)
    if (detailed.schemaClass === "Pathway" || detailed.schemaClass === "TopLevelPathway") {
      try {
        const containedEvents = await contentClient.get<Event[]>(
          `/data/pathway/${encodeURIComponent(detailed.stId)}/containedEvents`
        );

        const subPathways = containedEvents.filter(
          (e) => e.schemaClass === "Pathway"
        );
        const reactions = containedEvents.filter(
          (e) => e.schemaClass === "Reaction" || e.schemaClass === "BlackBoxEvent"
        );

        if (subPathways.length > 0) {
          lines.push("### Sub-pathways");
          const limit = detailLevel === "detailed" ? 15 : 5;
          subPathways.slice(0, limit).forEach((p) => {
            lines.push(`- **${p.displayName}** (\`${p.stId}\`)`);
          });
          if (subPathways.length > limit) {
            lines.push(`- *...and ${subPathways.length - limit} more*`);
          }
          lines.push("");
        }

        if (reactions.length > 0) {
          lines.push(`### Reactions`);
          lines.push(`This pathway involves **${reactions.length}** reactions.`);
          if (detailLevel === "detailed") {
            reactions.slice(0, 10).forEach((r) => {
              lines.push(`- ${r.displayName} (\`${r.stId}\`)`);
            });
            if (reactions.length > 10) {
              lines.push(`- *...and ${reactions.length - 10} more*`);
            }
          }
          lines.push("");
        }
      } catch {
        // Not a pathway or fetch failed — skip
      }
    }
  }

  // Step 6: Literature references
  if (
    detailed?.literatureReference &&
    detailed.literatureReference.length > 0
  ) {
    const limit = detailLevel === "brief" ? 2 : detailLevel === "standard" ? 3 : 5;
    lines.push("### Literature References");
    detailed.literatureReference.slice(0, limit).forEach((ref) => {
      if (ref.pubMedIdentifier) {
        lines.push(
          `- [${ref.displayName}](https://pubmed.ncbi.nlm.nih.gov/${ref.pubMedIdentifier})`
        );
      } else {
        lines.push(`- ${ref.displayName}`);
      }
    });
    if (detailed.literatureReference.length > limit) {
      lines.push(
        `- *...and ${detailed.literatureReference.length - limit} more references*`
      );
    }
    lines.push("");
  }

  // Step 7: Related results from search
  if (detailLevel === "detailed" && entries.length > 1) {
    lines.push("### Related Entries in Reactome");
    entries.slice(1, 6).forEach((entry) => {
      const entryName = stripHtml(entry.name);
      lines.push(`- **${entryName}** (\`${entry.stId}\`) — ${entry.exactType}`);
    });
    lines.push("");
  }

  // Step 8: Helpful next steps
  lines.push("### Explore Further");
  if (detailed?.stId) {
    lines.push(`- Use \`reactome_get_pathway\` with ID \`${detailed.stId}\` for full details`);
    if (detailed.hasDiagram) {
      lines.push(`- Use \`reactome_export_diagram\` with ID \`${detailed.stId}\` to get the pathway diagram`);
    }
    lines.push(`- Use \`reactome_participants\` with ID \`${detailed.stId}\` to see molecular participants`);
  }
  lines.push(
    `- Use \`reactome_search\` with query \`${query}\` to see all matching results`
  );

  return lines.join("\n");
}

export function registerAiExplainTools(server: McpServer) {
  server.tool(
    "reactome_ai_explain",
    "Get a clear, human-readable explanation of a biological concept, pathway, or entity using data from the Reactome knowledgebase. No API key required.",
    {
      query: z
        .string()
        .describe(
          'The biological concept or entity to explain (e.g., "TP53", "apoptosis", "cell cycle", "BRCA1")'
        ),
      detail_level: z
        .enum(["brief", "standard", "detailed"])
        .optional()
        .default("standard")
        .describe(
          "How detailed the explanation should be: brief (summary only), standard (with sub-pathways), detailed (comprehensive with reactions and references)"
        ),
    },
    async ({ query, detail_level }) => {
      try {
        const explanation = await buildExplanation(query, detail_level);
        return {
          content: [{ type: "text", text: explanation }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `## Error\n\nFailed to fetch data from Reactome: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
