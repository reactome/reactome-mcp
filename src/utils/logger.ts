/**
 * Logging utilities for tracking API calls, errors, and system events
 * Particularly important for evaluating fallback usage and performance
 */

import type { LogEvent, FallbackEvent, ApiErrorEvent } from "../types/unified.js";

/**
 * Logger instance for the system
 */
export class Logger {
  private logs: LogEvent[] = [];
  private maxLogs: number = 1000;
  private enableConsole: boolean;

  constructor(enableConsole: boolean = true) {
    this.enableConsole = enableConsole;
  }

  /**
   * Log an info-level event
   */
  info(source: string, message: string, context?: Record<string, unknown>): void {
    this.log({
      timestamp: Date.now(),
      level: "info",
      source,
      message,
      context,
    });
  }

  /**
   * Log a warning (used for fallback events)
   */
  warn(source: string, message: string, context?: Record<string, unknown>): void {
    this.log({
      timestamp: Date.now(),
      level: "warn",
      source,
      message,
      context,
    });
  }

  /**
   * Log a fallback event (important for evaluation)
   */
  fallback(
    source: "hybrid-retrieval" | "enrichment" | "routing",
    message: string,
    originalError?: string,
    fallbackStrategy?: string
  ): void {
    const event: FallbackEvent = {
      timestamp: Date.now(),
      level: "warn",
      source,
      message,
      originalError,
      fallbackStrategy,
    };

    this.log(event);

    if (this.enableConsole) {
      console.warn(
        `[FALLBACK] ${source}: ${message} (Strategy: ${fallbackStrategy})`,
        originalError ? `\nError: ${originalError}` : ""
      );
    }
  }

  /**
   * Log an API error (important for debugging)
   */
  apiError(
    source: string,
    message: string,
    statusCode?: number,
    endpoint?: string,
    retryable?: boolean
  ): void {
    const event: ApiErrorEvent = {
      timestamp: Date.now(),
      level: "error",
      source,
      message,
      statusCode,
      endpoint,
      retryable,
    };

    this.log(event);

    if (this.enableConsole) {
      console.error(
        `[API_ERROR] ${source}: ${message} (${statusCode}) - ${endpoint}`,
        retryable ? "(retryable)" : ""
      );
    }
  }

  /**
   * Log an error
   */
  error(source: string, message: string, context?: Record<string, unknown>): void {
    this.log({
      timestamp: Date.now(),
      level: "error",
      source,
      message,
      context,
    });

    if (this.enableConsole) {
      console.error(`[ERROR] ${source}: ${message}`, context);
    }
  }

  /**
   * Internal log function
   */
  private log(event: LogEvent): void {
    this.logs.push(event);

    // Keep logs bounded
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * Get all logs, optionally filtered
   */
  getLogs(
    filter?: {
      level?: LogEvent["level"];
      source?: string;
      since?: number; // timestamp in milliseconds
    }
  ): LogEvent[] {
    return this.logs.filter(log => {
      if (filter?.level && log.level !== filter.level) return false;
      if (filter?.source && log.source !== filter.source) return false;
      if (filter?.since && log.timestamp < filter.since) return false;
      return true;
    });
  }

  /**
   * Get stats on fallback usage
   */
  getFallbackStats(): {
    totalFallbacks: number;
    bySource: Record<string, number>;
    recent: FallbackEvent[];
  } {
    const fallbacks = this.logs.filter(log => log.level === "warn") as FallbackEvent[];

    const bySource: Record<string, number> = {};
    fallbacks.forEach(fb => {
      bySource[fb.source] = (bySource[fb.source] || 0) + 1;
    });

    return {
      totalFallbacks: fallbacks.length,
      bySource,
      recent: fallbacks.slice(-10),
    };
  }

  /**
   * Get stats on API errors
   */
  getErrorStats(): {
    totalErrors: number;
    bySource: Record<string, number>;
    retryableCount: number;
    recent: ApiErrorEvent[];
  } {
    const errors = this.logs.filter(log => log.level === "error") as ApiErrorEvent[];

    const bySource: Record<string, number> = {};
    let retryableCount = 0;

    errors.forEach(err => {
      bySource[err.source] = (bySource[err.source] || 0) + 1;
      if (err.retryable) retryableCount++;
    });

    return {
      totalErrors: errors.length,
      bySource,
      retryableCount,
      recent: errors.slice(-10),
    };
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger(process.env.NODE_ENV !== "production");

/**
 * Export factory for creating isolated loggers
 */
export function createLogger(name: string, enableConsole?: boolean): Logger {
  return new Logger(enableConsole);
}
