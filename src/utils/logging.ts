/**
 * Structured logging system for Reactome MCP
 * Outputs JSON logs to stderr for integration with monitoring systems
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

/**
 * Logger class for structured JSON logging
 */
class Logger {
  private minLevel: LogLevel;
  private readonly levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    if (level in this.levelOrder) {
      this.minLevel = level;
    }
  }

  /**
   * Log at debug level
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * Log at info level
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * Log at warn level
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /**
   * Log at error level
   */
  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    // Check if this level should be logged
    if (this.levelOrder[level] < this.levelOrder[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context || {}),
    };

    // Write to stderr as JSON
    console.error(JSON.stringify(entry));
  }
}

// Create singleton logger instance
const logger = new Logger(getDefaultLogLevel());

/**
 * Get default log level from environment
 */
function getDefaultLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level;
  }
  return 'info';
}

/**
 * Export singleton logger
 */
export default logger;

/**
 * Middleware for logging MCP tool calls
 */
export function createToolLogger(toolName: string) {
  return {
    /**
     * Log tool execution start
     */
    start: (args: Record<string, unknown>) => {
      logger.debug(`Tool called: ${toolName}`, {
        tool: toolName,
        args: JSON.stringify(args),
        event: 'tool_start',
      });
      return Date.now();
    },

    /**
     * Log tool execution success
     */
    success: (startTime: number, resultSize?: number) => {
      const duration = Date.now() - startTime;
      logger.info(`Tool executed: ${toolName}`, {
        tool: toolName,
        duration,
        resultSize,
        event: 'tool_success',
      });
    },

    /**
     * Log tool execution error
     */
    error: (startTime: number, error: Error, context?: Record<string, unknown>) => {
      const duration = Date.now() - startTime;
      logger.error(`Tool failed: ${toolName}`, {
        tool: toolName,
        duration,
        error: error.message,
        errorType: error.constructor.name,
        event: 'tool_error',
        ...context,
      });
    },
  };
}

/**
 * Log API client call
 */
export function logApiCall(
  service: string,
  method: string,
  path: string,
  statusCode?: number,
  duration?: number,
  error?: Error
) {
  if (error) {
    logger.warn(`API call failed: ${service}`, {
      service,
      method,
      path,
      statusCode,
      duration,
      error: error.message,
      event: 'api_call_failed',
    });
  } else {
    logger.debug(`API call: ${service}`, {
      service,
      method,
      path,
      statusCode,
      duration,
      event: 'api_call_success',
    });
  }
}

/**
 * Log cache operation
 */
export function logCacheOperation(
  operation: 'get' | 'set' | 'clear',
  key: string,
  hit?: boolean,
  duration?: number
) {
  logger.debug(`Cache ${operation}: ${key}`, {
    operation,
    key,
    hit,
    duration,
    event: 'cache_operation',
  });
}

/**
 * Log validation error
 */
export function logValidationError(field: string, reason: string, value?: unknown) {
  logger.warn(`Validation failed: ${field}`, {
    field,
    reason,
    value: typeof value === 'object' ? '[object]' : value,
    event: 'validation_error',
  });
}

/**
 * Log rate limit hit
 */
export function logRateLimit(tool: string, limit: number, window: number) {
  logger.warn(`Rate limit exceeded: ${tool}`, {
    tool,
    limit,
    window,
    event: 'rate_limit_exceeded',
  });
}
