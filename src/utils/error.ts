/**
 * Standardized error handling across all tools
 */

import { logger } from "./logger.js";
import type { ResponseMetadata } from "../types/unified.js";

/**
 * Standard error response for all tools
 */
export class ReactomeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number,
    public readonly retryable?: boolean,
    public readonly source?: string
  ) {
    super(message);
    this.name = "ReactomeError";
  }
}

/**
 * Error codes for the system
 */
export const ErrorCodes = {
  SEARCH_FAILED: "SEARCH_FAILED",
  PATHWAY_NOT_FOUND: "PATHWAY_NOT_FOUND",
  ANALYSIS_FAILED: "ANALYSIS_FAILED",
  ENRICHMENT_FAILED: "ENRICHMENT_FAILED",
  CACHE_ERROR: "CACHE_ERROR",
  INVALID_PARAMETERS: "INVALID_PARAMETERS",
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  FALLBACK_FAILED: "FALLBACK_FAILED",
} as const;

/**
 * Create error response metadata
 */
export function createErrorMetadata(
  source: ResponseMetadata["source"],
  fallbackUsed: boolean = false,
  warnings: string[] = []
): ResponseMetadata {
  return {
    timestamp: Date.now(),
    source,
    fallbackUsed,
    warnings,
    cacheHit: false,
  };
}

/**
 * Wrap API call with error handling and logging
 */
export async function withErrorHandling<T>(
  name: string,
  fn: () => Promise<T>,
  options?: {
    source?: string;
    retryable?: boolean;
    logErrors?: boolean;
  }
): Promise<{ success: true; data: T } | { success: false; error: ReactomeError }> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    const error = normalizeError(err, name, options?.source);

    if (options?.logErrors !== false) {
      if (error.statusCode && error.statusCode >= 500) {
        logger.apiError(
          error.source || options?.source || name,
          error.message,
          error.statusCode,
          undefined,
          options?.retryable ?? error.retryable
        );
      } else {
        logger.error(options?.source || name, error.message);
      }
    }

    return { success: false, error };
  }
}

/**
 * Normalize different error types
 */
export function normalizeError(error: unknown, context: string, source?: string): ReactomeError {
  if (error instanceof ReactomeError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message;

    // Detect network errors
    if (message.includes("fetch") || message.includes("Network") || message.includes("ECONNREFUSED")) {
      return new ReactomeError(
        ErrorCodes.NETWORK_ERROR,
        `Network error in ${context}: ${message}`,
        undefined,
        true,
        source
      );
    }

    // Detect timeout errors
    if (message.includes("timeout") || message.includes("timeout")) {
      return new ReactomeError(
        ErrorCodes.TIMEOUT,
        `Request timeout in ${context}: ${message}`,
        undefined,
        true,
        source
      );
    }

    // Detect 404 errors
    if (message.includes("404")) {
      return new ReactomeError(
        ErrorCodes.PATHWAY_NOT_FOUND,
        `Resource not found in ${context}: ${message}`,
        404,
        false,
        source
      );
    }

    // Detect service unavailable
    if (message.includes("503") || message.includes("Service Unavailable")) {
      return new ReactomeError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        `Service unavailable in ${context}: ${message}`,
        503,
        true,
        source
      );
    }

    return new ReactomeError(
      ErrorCodes.NETWORK_ERROR,
      `Error in ${context}: ${message}`,
      undefined,
      true,
      source
    );
  }

  return new ReactomeError(
    ErrorCodes.NETWORK_ERROR,
    `Unknown error in ${context}: ${String(error)}`,
    undefined,
    true,
    source
  );
}

/**
 * Create standardized error response for MCP tools
 */
export function createErrorResponse(error: ReactomeError, source: ResponseMetadata["source"]) {
  const metadata = createErrorMetadata(source, false, [error.message]);

  return {
    content: [
      {
        type: "text",
        text: `## Error: ${error.code}\n\n${error.message}\n\n**Status Code:** ${error.statusCode || "N/A"}\n**Retryable:** ${error.retryable ?? false}`,
      },
    ],
    metadata,
  };
}

/**
 * Safe JSON parse with error handling
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * Retry logic with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (i < maxRetries - 1) {
        const delay = delayMs * Math.pow(2, i); // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
