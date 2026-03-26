/**
 * Intelligent query routing system
 * Decides whether to call search, pathway, analysis, or combinations
 * Uses simple keyword-based heuristics
 */

import type { RoutingDecision } from "../types/unified.js";
import { logger } from "./logger.js";

/**
 * Default routing keywords
 */
const KEYWORDS = {
  search: ["find", "search", "query", "look for", "list", "show"],
  pathway: [
    "pathway",
    "reaction",
    "details",
    "describe",
    "tell me about",
    "what is",
    "explain",
    "ancestors",
    "children",
    "contained",
    "parents",
    "diagram",
  ],
  analysis: [
    "analyze",
    "enrichment",
    "over-represented",
    "significant",
    "pathway enrichment",
    "identify pathways",
    "test scores",
    "p-value",
    "statistical",
  ],
  combined: ["compare", "difference", "vs", "versus", "similar"],
};

/**
 * Router configuration
 */
export interface RouterConfig {
  defaultAction: RoutingDecision["action"];
  enableLearning: boolean;
  confidenceThreshold: number;
  customKeywords?: Partial<typeof KEYWORDS>;
}

/**
 * Query router class
 */
export class QueryRouter {
  private config: RouterConfig;
  private keywords: typeof KEYWORDS;

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = {
      defaultAction: "search",
      enableLearning: true,
      confidenceThreshold: 0.5,
      ...config,
    };

    this.keywords = {
      ...KEYWORDS,
      ...(config.customKeywords || {}),
    };
  }

  /**
   * Route a query to the most appropriate action
   */
  route(query: string): RoutingDecision {
    const lowerQuery = query.toLowerCase();

    // Extract potential identifiers (stId, dbId, etc.)
    const hasStableId = /R-[A-Z]{3}-\d+/.test(query);
    const hasDbId = /^\d{6,}$/.test(query.trim());

    // Score each action
    const scores = {
      search: this.scoreAction(lowerQuery, KEYWORDS.search),
      pathway: this.scoreAction(lowerQuery, KEYWORDS.pathway),
      analysis: this.scoreAction(lowerQuery, KEYWORDS.analysis),
      combined: this.scoreAction(lowerQuery, KEYWORDS.combined),
    };

    // Boost pathway score if stable ID detected
    if (hasStableId) {
      scores.pathway += 0.9;
    }

    // Boost pathway score for short IDs (likely database lookups)
    if (hasDbId) {
      scores.pathway += 0.8;
    }

    // Normalize scores to 0-1 range
    const maxScore = Math.max(...Object.values(scores));
    const normalizedScores: Record<string, number> = {};

    for (const [action, score] of Object.entries(scores)) {
      normalizedScores[action] = maxScore > 0 ? score / maxScore : 0;
    }

    // Determine primary action
    const sortedActions = (
      Object.entries(normalizedScores) as [RoutingDecision["action"], number][]
    ).sort(([, scoreA], [, scoreB]) => scoreB - scoreA);

    const primaryAction = sortedActions[0];
    const confidence = primaryAction[1];

    // If confidence is too low, default to search
    if (confidence < this.config.confidenceThreshold) {
      logger.info("query-router", `Low confidence routing (${confidence.toFixed(2)}), using default`, {
        query: query.substring(0, 100),
      });

      return {
        action: this.config.defaultAction,
        confidence: 0.3,
        reasoning: `Low confidence in other options; using ${this.config.defaultAction}`,
        alternativeActions: sortedActions
          .slice(1, 3)
          .map(([action, score]) => ({ action, confidence: score })),
      };
    }

    // Log routing decision
    logger.info("query-router", `Routed to ${primaryAction[0]} with confidence ${confidence.toFixed(2)}`, {
      query: query.substring(0, 100),
    });

    return {
      action: primaryAction[0],
      confidence,
      reasoning: this.generateReasoning(primaryAction[0], lowerQuery),
      alternativeActions: sortedActions
        .slice(1, 3)
        .map(([action, score]) => ({ action, confidence: score })),
      suggestedParameters: this.extractParameters(query, primaryAction[0]),
    };
  }

  /**
   * Score how well a query matches an action's keywords
   */
  private scoreAction(query: string, keywords: string[]): number {
    let score = 0;

    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${keyword}\\b`, "g");
      const matches = query.match(pattern);

      if (matches) {
        // Weight multiple matches but with diminishing returns
        score += Math.min(2, matches.length * 0.5);
      }
    }

    return score;
  }

  /**
   * Generate human-readable reasoning for the routing decision
   */
  private generateReasoning(action: RoutingDecision["action"], query: string): string {
    const matchedKeywords = this.findMatchingKeywords(query, action);

    switch (action) {
      case "search":
        return `Query contains search keywords (${matchedKeywords}). Using search to find relevant entities.`;
      case "pathway":
        return `Query requests pathway details (${matchedKeywords}). Fetching pathway information.`;
      case "analysis":
        return `Query involves enrichment/statistical analysis (${matchedKeywords}). Using analysis tools.`;
      case "combined":
        return `Query requires comparison or multiple data sources (${matchedKeywords}). Using combined approach.`;
      default:
        return `Routing to ${action} based on query content.`;
    }
  }

  /**
   * Find which keywords matched
   */
  private findMatchingKeywords(query: string, action: RoutingDecision["action"]): string {
    const keywords = this.keywords[action as keyof typeof KEYWORDS] || [];
    const matched: string[] = [];

    for (const keyword of keywords) {
      if (query.includes(keyword)) {
        matched.push(keyword);
      }
    }

    return matched.slice(0, 3).join(", ") || "general keywords";
  }

  /**
   * Extract parameters for the suggested action
   */
  private extractParameters(query: string, action: RoutingDecision["action"]): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // Extract stable ID
    const stableIdMatch = query.match(/R-[A-Z]{3}-\d+/i);
    if (stableIdMatch) {
      params.id = stableIdMatch[0];
    }

    // Extract species if mentioned
    const speciesMatch = query.match(/homo\s+sapiens|mouse|human|yeast|c\.?\s*elegans/i);
    if (speciesMatch) {
      params.species = speciesMatch[0];
    }

    return params;
  }
}

/**
 * Global router instance
 */
export const globalRouter = new QueryRouter();

/**
 * Route a query using the global router
 */
export function routeQuery(query: string): RoutingDecision {
  return globalRouter.route(query);
}
