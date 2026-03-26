/**
 * Unified response types for all tools
 * Ensures consistent API across the system
 */

/**
 * Standard metadata included in all responses
 */
export interface ResponseMetadata {
  timestamp: number;
  source: "search" | "pathway" | "analysis" | "enrichment" | "routing";
  confidence?: number; // 0-1 score for search results
  fallbackUsed?: boolean; // True if fallback mechanism was triggered
  cacheHit?: boolean; // True if result was from cache
  executionTimeMs?: number;
  warnings?: string[];
}

/**
 * Unified response wrapper for all tool outputs
 */
export interface UnifiedResponse<T> {
  summary: string;
  data: T;
  metadata: ResponseMetadata;
  explanation?: string; // Optional detailed explanation
}

/**
 * Enhanced pathway result with statistics
 */
export interface EnrichedPathway {
  stId: string;
  dbId: number;
  displayName: string;
  name: string;
  speciesName?: string;
  schemaClass: string;
  isInDisease?: boolean;
  hasDiagram?: boolean;
  
  // Enrichment data
  summation?: string; // Main summary text
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
  references?: Array<{
    displayName: string;
    pubMedId?: number;
  }>;
  
  // Optional explanation for routing/analysis
  explanation?: string;
}

/**
 * Enhanced analysis result with key statistics
 */
export interface EnrichedAnalysisResult {
  token: string;
  type: string;
  species: string;
  totalPathways: number;
  significantPathways: number; // Count below p-value threshold
  
  // Key statistics
  statistics: {
    minPValue: number;
    maxPValue: number;
    medianFDR: number;
    identifiersFound: number;
    identifiersNotFound?: number;
  };
  
  // Top pathways (summary)
  topPathways: Array<{
    stId: string;
    name: string;
    pValue: number;
    fdr: number;
    entitiesFound: number;
    entitiesTotal: number;
  }>;
  
  explanation?: string;
}

/**
 * Search result with confidence and source tracking
 */
export interface HybridSearchResult {
  entries: Array<{
    dbId: string;
    stId: string;
    name: string;
    type: string;
    exactType: string;
    species: string[];
    summation?: string;
    confidence?: number; // 0-1 based on search ranking
    source: "embedding" | "search"; // Where result came from
  }>;
  
  totalCount: number;
  uniqueResults: number; // After deduplication
  facets?: Record<string, Array<{name: string; count: number}>>;
}

/**
 * Query routing decision
 */
export interface RoutingDecision {
  action: "search" | "pathway" | "analysis" | "combined";
  confidence: number; // 0-1
  reasoning: string;
  suggestedParameters?: Record<string, unknown>;
  alternativeActions?: Array<{
    action: string;
    confidence: number;
  }>;
}

/**
 * Cache entry with TTL
 */
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number; // milliseconds
  hits: number;
  source?: string; // For debugging which api returned this
}

/**
 * Logging event structures
 */
export interface LogEvent {
  timestamp: number;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface FallbackEvent extends LogEvent {
  level: "warn";
  source: "hybrid-retrieval" | "enrichment" | "routing";
  originalError?: string;
  fallbackStrategy?: string;
}

export interface ApiErrorEvent extends LogEvent {
  level: "error";
  source: string;
  statusCode?: number;
  endpoint?: string;
  retryable?: boolean;
}
