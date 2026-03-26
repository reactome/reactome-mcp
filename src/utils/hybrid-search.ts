/**
 * Hybrid retrieval system combining embedding-based lookup with fallback to search API
 * Provides merged and deduplicated results across multiple strategies
 */

import { contentClient } from "../clients/content.js";
import { globalCache, cachedCall, generateCacheKey } from "../clients/cache.js";
import { logger } from "./logger.js";
import type { SearchResult, SearchEntry } from "../types/index.js";
import type { HybridSearchResult } from "../types/unified.js";

/**
 * Mock embedding-based lookup
 * In production, this would connect to a vector database
 */
export class EmbeddingLookup {
  /**
   * Simulate embedding-based search
   * Returns results with confidence scores
   */
  async lookup(query: string, topK: number = 10): Promise<HybridSearchResult> {
    // Simulate embedding computation and lookup
    // In production: query -> embedding -> vector search -> results with scores

    const mockEmbeddingResults: HybridSearchResult = {
      entries: [],
      totalCount: 0,
      uniqueResults: 0,
    };

    // Log that we attempted embedding lookup
    logger.info("embedding-lookup", "Performed embedding-based search", {
      query,
      topK,
      resultsFound: 0,
    });

    return mockEmbeddingResults;
  }
}

/**
 * Fallback search using Reactome API
 */
export class FallbackSearch {
  async search(
    query: string,
    topK: number = 25,
    filters?: {
      species?: string;
      types?: string[];
      compartments?: string[];
    }
  ): Promise<HybridSearchResult> {
    const params: Record<string, string | number | boolean | undefined> = {
      query,
      rows: topK,
    };

    if (filters?.species) {
      params.species = filters.species;
    }
    if (filters?.types && filters.types.length > 0) {
      params.types = filters.types.join(",");
    }
    if (filters?.compartments && filters.compartments.length > 0) {
      params.compartments = filters.compartments.join(",");
    }

    const result = await contentClient.get<SearchResult>("/search/query", params);

    const entries: HybridSearchResult["entries"] = [];
    let totalCount = 0;

    // Flatten and transform search results
    for (const group of result.results) {
      totalCount += group.entriesCount;

      for (const entry of group.entries) {
        entries.push({
          dbId: entry.dbId,
          stId: entry.stId,
          name: entry.name,
          type: entry.type,
          exactType: entry.exactType,
          species: entry.species,
          summation: entry.summation,
          confidence: 0.8, // Reactome search results get high confidence
          source: "search",
        });
      }
    }

    logger.info("fallback-search", "Performed fallback API search", {
      query,
      resultsFound: entries.length,
      totalCount,
    });

    return {
      entries,
      totalCount,
      uniqueResults: entries.length,
    };
  }
}

/**
 * Hybrid retrieval orchestrator
 */
export class HybridRetriever {
  private embedding: EmbeddingLookup;
  private fallback: FallbackSearch;

  constructor() {
    this.embedding = new EmbeddingLookup();
    this.fallback = new FallbackSearch();
  }

  /**
   * Perform hybrid search with fallback
   * Strategy: Try embedding lookup first, fall back to search API if needed
   */
  async search(
    query: string,
    options?: {
      topK?: number;
      species?: string;
      types?: string[];
      compartments?: string[];
      useEmbedding?: boolean;
      confidenceThreshold?: number;
    }
  ): Promise<HybridSearchResult> {
    const startTime = Date.now();
    const topK = options?.topK ?? 25;
    const confidenceThreshold = options?.confidenceThreshold ?? 0.5;
    const useEmbedding = options?.useEmbedding ?? true;

    // Try embedding lookup first (if enabled)
    let results: HybridSearchResult | null = null;
    let fallbackUsed = false;

    if (useEmbedding) {
      try {
        results = await this.embedding.lookup(query, topK);

        // Check if embedding results are sufficient
        if (results.entries.length > 0) {
          const avgConfidence = results.entries.reduce((sum, e) => sum + (e.confidence ?? 0), 0) / results.entries.length;

          if (avgConfidence >= confidenceThreshold) {
            logger.info("hybrid-retriever", "Using embedding results (sufficient confidence)", {
              query,
              resultCount: results.entries.length,
              avgConfidence: avgConfidence.toFixed(2),
            });

            return this.enrichResults(results, startTime);
          }
        }

        // Log embedding fallback
        if (results.entries.length === 0 || !results.entries.length) {
          logger.fallback(
            "hybrid-retrieval",
            `Embedding lookup returned no results for query: "${query.substring(0, 50)}"`,
            "No embedding results found",
            "fallback-to-search"
          );
        }
      } catch (err) {
        logger.fallback(
          "hybrid-retrieval",
          `Embedding lookup failed for query: "${query.substring(0, 50)}"`,
          err instanceof Error ? err.message : String(err),
          "fallback-to-search"
        );
      }

      fallbackUsed = true;
    }

    // Fall back to search API
    try {
      const searchResults = await this.fallback.search(query, topK, {
        species: options?.species,
        types: options?.types, 
        compartments: options?.compartments,
      });

      // Merge results
      if (results && results.entries.length > 0) {
        results = this.mergeResults(results, searchResults);
      } else {
        results = searchResults;
      }

      return this.enrichResults(results, startTime, fallbackUsed);
    } catch (err) {
      logger.error("hybrid-retriever", `Search API failed: ${err instanceof Error ? err.message : String(err)}`, {
        query: query.substring(0, 50),
      });

      // If we still have embedding results, return them
      if (results && results.entries.length > 0) {
        return this.enrichResults(results, startTime, fallbackUsed);
      }

      throw err;
    }
  }

  /**
   * Merge results from multiple sources and deduplicate
   */
  private mergeResults(embedding: HybridSearchResult, search: HybridSearchResult): HybridSearchResult {
    const merged = new Map<string, HybridSearchResult["entries"][0]>();

    // Add embedding results
    for (const entry of embedding.entries) {
      const key = `${entry.stId}-${entry.exactType}`;
      merged.set(key, entry);
    }

    // Add search results (merge if duplicate with higher priority to search)
    for (const entry of search.entries) {
      const key = `${entry.stId}-${entry.exactType}`;

      if (merged.has(key)) {
        // Keep existing but update confidence if search has higher confidence
        const existing = merged.get(key)!;
        if ((entry.confidence ?? 0.8) > (existing.confidence ?? 0)) {
          existing.confidence = entry.confidence ?? 0.8;
        }
      } else {
        merged.set(key, entry);
      }
    }

    const uniqueEntries = Array.from(merged.values()).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

    return {
      entries: uniqueEntries.slice(0, 25),
      totalCount: uniqueEntries.length,
      uniqueResults: uniqueEntries.length,
    };
  }

  /**
   * Enrich results with metadata
   */
  private enrichResults(
    results: HybridSearchResult,
    startTime: number,
    fallbackUsed: boolean = false
  ): HybridSearchResult {
    const executionTimeMs = Date.now() - startTime;

    logger.info("hybrid-retriever", "Hybrid search completed", {
      resultCount: results.entries.length,
      uniqueResults: results.uniqueResults,
      executionTimeMs,
      fallbackUsed,
    });

    return results;
  }
}

/**
 * Global hybrid retriever instance
 */
export const globalHybridRetriever = new HybridRetriever();

/**
 * Perform hybrid search using global instance
 */
export async function hybridSearch(
  query: string,
  options?: Parameters<HybridRetriever["search"]>[1]
): Promise<HybridSearchResult> {
  const cacheKey = generateCacheKey("hybrid-search", { query, ...options });

  const { value, cached } = await cachedCall(
    cacheKey,
    () => globalHybridRetriever.search(query, options),
    5 * 60 * 1000, // 5 minute TTL
    "hybrid-retriever"
  );

  if (cached) {
    logger.info("hybrid-search", "Retrieved from cache", { query: query.substring(0, 50) });
  }

  return value;
}
