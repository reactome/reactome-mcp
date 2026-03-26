/**
 * Result enrichment utilities
 * Adds statistics and details to pathway and analysis results
 */

import { contentClient } from "../clients/content.js";
import { globalCache, cachedCall, generateCacheKey } from "../clients/cache.js";
import { logger } from "./logger.js";
import type { Pathway, Event } from "../types/content.js";
import type { EnrichedPathway, PathwaySummary } from "../types/unified.js";

/**
 * Enrich a pathway with additional statistics and details
 */
export async function enrichPathway(pathway: Pathway | Event): Promise<EnrichedPathway> {
  const enriched: EnrichedPathway = {
    stId: pathway.stId,
    dbId: pathway.dbId,
    displayName: pathway.displayName,
    name: pathway.name,
    speciesName: pathway.speciesName,
    schemaClass: pathway.schemaClass,
    isInDisease: pathway.isInDisease,
    hasDiagram: pathway.hasDiagram,
  };

  // Add summation from event
  if ("summation" in pathway && pathway.summation && pathway.summation.length > 0) {
    enriched.summation = pathway.summation[0].text;
  }

  // Add literature references
  if ("literatureReference" in pathway && pathway.literatureReference && pathway.literatureReference.length > 0) {
    enriched.references = pathway.literatureReference.slice(0, 5).map(ref => ({
      displayName: ref.displayName,
      pubMedId: ref.pubMedIdentifier,
    }));
  }

  // Fetch additional statistics if this is a pathway
  try {
    if (pathway.schemaClass === "Pathway") {
      const stats = await getPathwayStatistics(pathway.stId);
      enriched.reactions = stats.reactions;
      enriched.entities = stats.entities;
    }
  } catch (err) {
    logger.warn("enrichment", `Could not fetch statistics for ${pathway.stId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return enriched;
}

/**
 * Get pathway statistics (reactions, entities)
 */
export async function getPathwayStatistics(
  pathwayId: string
): Promise<{
  reactions?: {
    total: number;
    major?: number;
  };
  entities?: {
    total: number;
    proteins?: number;
    complexes?: number;
    compounds?: number;
  };
}> {
  const cacheKey = generateCacheKey("pathway-stats", { pathwayId });

  const { value } = await cachedCall(
    cacheKey,
    async () => {
      try {
        // Try to get contained events to count reactions
        const containedEvents = await contentClient.get<Event[]>(
          `/data/pathway/${encodeURIComponent(pathwayId)}/containedEvents`
        );

        const reactions = containedEvents.filter(
          e => e.schemaClass === "Reaction" || e.schemaClass === "BlackBoxEvent"
        );

        return {
          reactions: {
            total: reactions.length,
          },
          entities: {
            total: 0, // Would require more API calls to get accurate counts
          },
        };
      } catch (err) {
        logger.warn(
          "pathway-statistics",
          `Could not fetch statistics for ${pathwayId}: ${err instanceof Error ? err.message : String(err)}`
        );
        return {};
      }
    },
    30 * 60 * 1000, // 30 minute cache TTL
    "pathway-enrichment"
  );

  return value;
}

/**
 * Generate explanation for a pathway based on enrichment data
 */
export function generatePathwayExplanation(enriched: EnrichedPathway): string {
  const parts: string[] = [];

  if (enriched.summation) {
    parts.push(`This pathway ${enriched.summation.toLowerCase()}`);
  } else {
    parts.push(`This is a ${enriched.schemaClass.toLowerCase()} in ${enriched.speciesName}`);
  }

  if (enriched.reactions && enriched.reactions.total > 0) {
    parts.push(`It contains ${enriched.reactions.total} reaction(s)`);
  }

  if (enriched.isInDisease) {
    parts.push("and is implicated in disease processes");
  }

  if (enriched.hasDiagram) {
    parts.push("A diagram is available for visualization");
  }

  if (enriched.references && enriched.references.length > 0) {
    parts.push(`See ${enriched.references.length} key reference(s) for more details`);
  }

  return parts.join(". ") + ".";
}

/**
 * Enrich analysis pathway summary with details
 */
export async function enrichAnalysisPathway(pathway: PathwaySummary): Promise<EnrichedPathway & {pValue: number; fdr: number; entitiesFound: number}> {
  const cacheKey = generateCacheKey("pathway-details", { stId: pathway.stId });

  const { value: pathwayDetails } = await cachedCall(
    cacheKey,
    async () => {
      try {
        return await contentClient.get<Event>(`/data/query/enhanced/${encodeURIComponent(pathway.stId)}`);
      } catch (err) {
        logger.warn("enrichment", `Could not fetch details for ${pathway.stId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    30 * 60 * 1000,
    "analysis-enrichment"
  );

  const base = pathwayDetails
    ? await enrichPathway(pathwayDetails)
    : {
        stId: pathway.stId,
        dbId: pathway.dbId,
        displayName: pathway.name,
        name: pathway.name,
        speciesName: pathway.species.name,
        schemaClass: "Pathway",
      };

  return {
    ...base,
    pValue: pathway.entities.pValue,
    fdr: pathway.entities.fdr,
    entitiesFound: pathway.entities.found,
  };
}

/**
 * Format enriched pathway for display
 */
export function formatEnrichedPathway(enriched: EnrichedPathway & {pValue?: number; fdr?: number; entitiesFound?: number}): string {
  const lines = [
    `## ${enriched.displayName}`,
    `**ID:** ${enriched.stId} | **Type:** ${enriched.schemaClass}`,
  ];

  if (enriched.speciesName) {
    lines.push(`**Species:** ${enriched.speciesName}`);
  }

  if (enriched.pValue !== undefined) {
    lines.push(`**Statistical Significance:**`);
    lines.push(`  - p-value: ${enriched.pValue.toExponential(2)}`);
    lines.push(`  - FDR: ${enriched.fdr?.toExponential(2) ?? "N/A"}`);
    lines.push(`  - Entities found: ${enriched.entitiesFound ?? 0}`);
  }

  if (enriched.reactions || enriched.entities) {
    lines.push(`**Structure:**`);
    if (enriched.reactions) {
      lines.push(`  - Reactions: ${enriched.reactions.total}`);
    }
    if (enriched.entities) {
      lines.push(`  - Entities: ${enriched.entities.total}`);
    }
  }

  if (enriched.isInDisease) {
    lines.push(`**Involvement:** Disease pathway`);
  }

  if (enriched.summation) {
    lines.push("", "**Summary:**", enriched.summation);
  }

  if (enriched.references && enriched.references.length > 0) {
    lines.push("", "**Key References:**");
    enriched.references.forEach(ref => {
      if (ref.pubMedId) {
        lines.push(`  - [${ref.displayName}](https://pubmed.ncbi.nlm.nih.gov/${ref.pubMedId})`);
      } else {
        lines.push(`  - ${ref.displayName}`);
      }
    });
  }

  if (enriched.explanation) {
    lines.push("", "**Explanation:**", enriched.explanation);
  }

  return lines.join("\n");
}
