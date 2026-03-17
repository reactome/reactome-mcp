/**
 * Configuration for Reactome MCP
 * Supports environment-based configuration with sensible defaults
 */

// API Service URLs (can be overridden via environment variables)
export const CONTENT_SERVICE_URL =
  process.env.CONTENT_SERVICE_URL || "https://reactome.org/ContentService/";

export const ANALYSIS_SERVICE_URL =
  process.env.ANALYSIS_SERVICE_URL || "https://reactome.org/AnalysisService/";

// API Timeouts (milliseconds)
export const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || "15000", 10);
export const HEAVY_REQUEST_TIMEOUT = parseInt(process.env.HEAVY_REQUEST_TIMEOUT || "30000", 10);

// Retry Configuration
export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);
export const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || "1000", 10);

// Cache TTLs (seconds)
export const CACHE_TTL_SPECIES = parseInt(process.env.CACHE_TTL_SPECIES || "3600", 10); // 1 hour
export const CACHE_TTL_DISEASES = parseInt(process.env.CACHE_TTL_DISEASES || "3600", 10); // 1 hour
export const CACHE_TTL_DBINFO = parseInt(process.env.CACHE_TTL_DBINFO || "86400", 10); // 24 hours
export const CACHE_TTL_QUERIES = parseInt(process.env.CACHE_TTL_QUERIES || "300", 10); // 5 minutes

// Input Validation Limits
export const MAX_BATCH_IDENTIFIERS = parseInt(process.env.MAX_BATCH_IDENTIFIERS || "50000", 10);
export const MAX_SEARCH_QUERY_LENGTH = parseInt(process.env.MAX_SEARCH_QUERY_LENGTH || "500", 10);
export const MAX_PAGE_SIZE = parseInt(process.env.MAX_PAGE_SIZE || "100", 10);

// Rate Limiting (requests per minute)
export const RATE_LIMIT_ANALYSIS = parseInt(process.env.RATE_LIMIT_ANALYSIS || "10", 10);
export const RATE_LIMIT_SEARCH = parseInt(process.env.RATE_LIMIT_SEARCH || "20", 10);
export const RATE_LIMIT_GENERAL = parseInt(process.env.RATE_LIMIT_GENERAL || "30", 10);

// Logging
export const LOG_LEVEL = (process.env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error";

// Environment
export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PRODUCTION = NODE_ENV === "production";

// Default behavior
export const DEFAULT_SPECIES = process.env.DEFAULT_SPECIES || "Homo sapiens";
export const DEFAULT_PAGE_SIZE = parseInt(process.env.DEFAULT_PAGE_SIZE || "25", 10);

export const SORT_OPTIONS = [
  "NAME",
  "TOTAL_ENTITIES",
  "TOTAL_INTERACTORS",
  "TOTAL_REACTIONS",
  "FOUND_ENTITIES",
  "FOUND_INTERACTORS",
  "FOUND_REACTIONS",
  "ENTITIES_RATIO",
  "ENTITIES_PVALUE",
  "ENTITIES_FDR",
  "REACTIONS_RATIO",
] as const;

export const RESOURCE_TYPES = [
  "TOTAL",
  "UNIPROT",
  "ENSEMBL",
  "CHEBI",
  "IUPHAR",
  "MIRBASE",
  "NCBI_PROTEIN",
  "EMBL",
  "COMPOUND",
] as const;

export const DIAGRAM_FORMATS = ["png", "jpg", "jpeg", "svg", "gif"] as const;
