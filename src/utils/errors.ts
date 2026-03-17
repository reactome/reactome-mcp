/**
 * Error handling system for Reactome MCP
 * Provides typed error classes with context and structured information
 */

/**
 * Base class for all Reactome MCP errors
 */
export class ReactomeError extends Error {
  public readonly statusCode?: number;
  public readonly context: Record<string, unknown>;
  public readonly originalError?: Error;
  public readonly timestamp: Date;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'ReactomeError';
    this.statusCode = options?.statusCode;
    this.context = options?.context || {};
    this.originalError = options?.cause;
    this.timestamp = new Date();

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, ReactomeError.prototype);
  }

  /**
   * Serialize error to JSON for logging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      originalError: this.originalError?.message,
      stack: this.stack,
    };
  }
}

/**
 * Error for API service failures (timeout, network, API errors)
 */
export class ServiceError extends ReactomeError {
  public readonly service: string;
  public readonly path?: string;
  public readonly method?: string;
  public readonly retryable: boolean;

  constructor(
    message: string,
    options?: {
      service?: string;
      path?: string;
      method?: string;
      statusCode?: number;
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, {
      statusCode: options?.statusCode,
      context: options?.context,
      cause: options?.cause,
    });
    this.name = 'ServiceError';
    this.service = options?.service || 'Unknown';
    this.path = options?.path;
    this.method = options?.method;
    this.retryable = options?.retryable ?? isRetryableStatus(options?.statusCode);

    Object.setPrototypeOf(this, ServiceError.prototype);
  }

  /**
   * Get human-readable error message with retry advice
   */
  getActionableMessage(): string {
    const base = this.message;

    if (this.statusCode === 404) {
      return `${base} (Resource not found - check the ID)`;
    }
    if (this.statusCode === 400) {
      return `${base} (Invalid request - check parameters)`;
    }
    if (this.statusCode === 429) {
      return `${base} (Too many requests - please wait and retry)`;
    }
    if (this.statusCode === 503) {
      return `${base} (Service temporarily unavailable - retrying)`;
    }
    if (this.statusCode && this.statusCode >= 500) {
      return `${base} (Server error - please retry later)`;
    }
    if (this.retryable) {
      return `${base} (Network issue - retrying)`;
    }

    return base;
  }
}

/**
 * Error for input validation failures
 */
export class ValidationError extends ReactomeError {
  public readonly field?: string;
  public readonly value?: unknown;
  public readonly rule?: string;

  constructor(
    message: string,
    options?: {
      field?: string;
      value?: unknown;
      rule?: string;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, { context: options?.context });
    this.name = 'ValidationError';
    this.field = options?.field;
    this.value = options?.value;
    this.rule = options?.rule;

    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error for network/connectivity issues
 */
export class NetworkError extends ServiceError {
  constructor(
    message: string,
    options?: {
      service?: string;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, {
      service: options?.service,
      statusCode: 0,
      retryable: true,
      context: options?.context,
      cause: options?.cause,
    });
    this.name = 'NetworkError';

    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Error for rate limiting
 */
export class RateLimitError extends ServiceError {
  public readonly retryAfter?: number; // seconds

  constructor(
    message: string,
    options?: {
      service?: string;
      retryAfter?: number;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, {
      service: options?.service,
      statusCode: 429,
      retryable: true,
      context: options?.context,
    });
    this.name = 'RateLimitError';
    this.retryAfter = options?.retryAfter;

    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Error for request timeouts
 */
export class TimeoutError extends ServiceError {
  public readonly timeout: number; // milliseconds

  constructor(
    message: string,
    options?: {
      service?: string;
      timeout?: number;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, {
      service: options?.service,
      retryable: true,
      context: options?.context,
      cause: options?.cause,
    });
    this.name = 'TimeoutError';
    this.timeout = options?.timeout || 0;

    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Determine if an HTTP status code is retryable
 */
function isRetryableStatus(status?: number): boolean {
  if (!status) return true; // Network errors are retryable
  // Retry on 5xx, 429 (rate limit), 408 (timeout)
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

/**
 * Format error for display to user (LLM-friendly)
 */
export function formatErrorForLLM(error: Error): string {
  if (error instanceof ServiceError) {
    const message = error.getActionableMessage();
    if (error.retryable) {
      return `${message} (this operation will be retried automatically)`;
    }
    return message;
  }

  if (error instanceof ValidationError) {
    if (error.field) {
      return `Invalid ${error.field}: ${error.message}`;
    }
    return error.message;
  }

  if (error instanceof ReactomeError) {
    return error.message;
  }

  return error.message || 'An unknown error occurred';
}

/**
 * Check if an error is worth retrying
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ServiceError) {
    return error.retryable;
  }
  if (error instanceof NetworkError) {
    return true;
  }
  if (error instanceof TimeoutError) {
    return true;
  }
  return false;
}
