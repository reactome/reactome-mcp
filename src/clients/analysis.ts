import { ANALYSIS_SERVICE_URL, REQUEST_TIMEOUT, HEAVY_REQUEST_TIMEOUT, MAX_RETRIES, RETRY_DELAY_MS } from "../config.js";
import { ServiceError, TimeoutError, NetworkError } from "../utils/errors.js";
import { logApiCall, logCacheOperation } from "../utils/logging.js";
import { caches } from "../utils/cache.js";

export class AnalysisClient {
  private baseUrl: string;
  private requestTimeout: number;
  private heavyRequestTimeout: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(
    baseUrl: string = ANALYSIS_SERVICE_URL,
    options?: {
      requestTimeout?: number;
      heavyRequestTimeout?: number;
      maxRetries?: number;
      retryDelayMs?: number;
    }
  ) {
    this.baseUrl = baseUrl;
    this.requestTimeout = options?.requestTimeout ?? REQUEST_TIMEOUT;
    this.heavyRequestTimeout = options?.heavyRequestTimeout ?? HEAVY_REQUEST_TIMEOUT;
    this.maxRetries = options?.maxRetries ?? MAX_RETRIES;
    this.retryDelayMs = options?.retryDelayMs ?? RETRY_DELAY_MS;
  }

  private resolvePath(path: string): URL {
    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    return new URL(relativePath, this.baseUrl);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { isHeavy?: boolean }
  ): Promise<T> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;
    const url = this.resolvePath(path);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const text = await response.text();
          const isRetryable = response.status === 429 || response.status === 503;
          const error = new ServiceError(`Analysis Service error ${response.status}`, {
            service: 'AnalysisService',
            path,
            method: 'GET',
            statusCode: response.status,
            retryable: isRetryable,
            context: { endpoint: url.toString(), textError: text },
          });

          logApiCall('AnalysisService', 'GET', path, response.status, duration, error);

          if (isRetryable && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('AnalysisService', 'GET', path, response.status, duration);
        return response.json() as Promise<T>;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Analysis Service request timeout', {
            service: 'AnalysisService',
            timeout,
            context: { path, attempt },
          });
          logApiCall('AnalysisService', 'GET', path, undefined, duration, timeoutError);

          if (attempt < this.maxRetries) {
            lastError = timeoutError;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw timeoutError;
        }

        if (error instanceof ServiceError) {
          throw error;
        }

        const networkError = new NetworkError('Analysis Service network error', {
          service: 'AnalysisService',
          context: { path, attempt },
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('AnalysisService', 'GET', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Analysis Service request failed after retries', {
      service: 'AnalysisService',
      context: { path, attempts: this.maxRetries + 1 },
    });
  }

  async postIdentifiers<T>(
    path: string,
    identifiers: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { isHeavy?: boolean }
  ): Promise<T> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;
    const url = this.resolvePath(path);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'text/plain',
          },
          body: identifiers,
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const text = await response.text();
          const isRetryable = response.status === 429 || response.status === 503;
          const error = new ServiceError(`Analysis Service error ${response.status}`, {
            service: 'AnalysisService',
            path,
            method: 'POST',
            statusCode: response.status,
            retryable: isRetryable,
            context: { endpoint: url.toString(), textError: text },
          });

          logApiCall('AnalysisService', 'POST', path, response.status, duration, error);

          if (isRetryable && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('AnalysisService', 'POST', path, response.status, duration);
        return response.json() as Promise<T>;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Analysis Service request timeout', {
            service: 'AnalysisService',
            timeout,
            context: { path, attempt, identifierCount: identifiers.split('\n').length },
          });
          logApiCall('AnalysisService', 'POST', path, undefined, duration, timeoutError);

          if (attempt < this.maxRetries) {
            lastError = timeoutError;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw timeoutError;
        }

        if (error instanceof ServiceError) {
          throw error;
        }

        const networkError = new NetworkError('Analysis Service network error', {
          service: 'AnalysisService',
          context: { path, attempt },
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('AnalysisService', 'POST', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Analysis Service request failed after retries', {
      service: 'AnalysisService',
      context: { path, attempts: this.maxRetries + 1 },
    });
  }

  async postJson<T>(
    path: string,
    body: unknown,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { isHeavy?: boolean }
  ): Promise<T> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;
    const url = this.resolvePath(path);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'text/plain',
          },
          body: String(body),
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const text = await response.text();
          const isRetryable = response.status === 429 || response.status === 503;
          const error = new ServiceError(`Analysis Service error ${response.status}`, {
            service: 'AnalysisService',
            path,
            method: 'POST',
            statusCode: response.status,
            retryable: isRetryable,
            context: { endpoint: url.toString(), textError: text },
          });

          logApiCall('AnalysisService', 'POST', path, response.status, duration, error);

          if (isRetryable && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('AnalysisService', 'POST', path, response.status, duration);
        return response.json() as Promise<T>;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Analysis Service request timeout', {
            service: 'AnalysisService',
            timeout,
            context: { path, attempt },
          });
          logApiCall('AnalysisService', 'POST', path, undefined, duration, timeoutError);

          if (attempt < this.maxRetries) {
            lastError = timeoutError;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw timeoutError;
        }

        if (error instanceof ServiceError) {
          throw error;
        }

        const networkError = new NetworkError('Analysis Service network error', {
          service: 'AnalysisService',
          context: { path, attempt },
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('AnalysisService', 'POST', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Analysis Service request failed after retries', {
      service: 'AnalysisService',
      context: { path, attempts: this.maxRetries + 1 },
    });
  }

  async getBinary(path: string, options?: { isHeavy?: boolean }): Promise<Buffer> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;
    const url = this.resolvePath(path);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), { signal: controller.signal });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const error = new ServiceError(`Analysis Service error ${response.status}`, {
            service: 'AnalysisService',
            path,
            method: 'GET',
            statusCode: response.status,
            retryable: response.status === 429 || response.status === 503,
          });

          logApiCall('AnalysisService', 'GET', path, response.status, duration, error);

          if ((response.status === 429 || response.status === 503) && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('AnalysisService', 'GET', path, response.status, duration);
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Analysis Service request timeout', {
            service: 'AnalysisService',
            timeout,
            context: { path },
          });
          logApiCall('AnalysisService', 'GET', path, undefined, duration, timeoutError);

          if (attempt < this.maxRetries) {
            lastError = timeoutError;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw timeoutError;
        }

        if (error instanceof ServiceError) {
          throw error;
        }

        const networkError = new NetworkError('Analysis Service network error', {
          service: 'AnalysisService',
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('AnalysisService', 'GET', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Analysis Service request failed after retries', {
      service: 'AnalysisService',
      context: { path },
    });
  }

  async getCsv(path: string, options?: { isHeavy?: boolean }): Promise<string> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;
    const url = this.resolvePath(path);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'text/csv' },
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const error = new ServiceError(`Analysis Service error ${response.status}`, {
            service: 'AnalysisService',
            path,
            method: 'GET',
            statusCode: response.status,
            retryable: response.status === 429 || response.status === 503,
          });

          logApiCall('AnalysisService', 'GET', path, response.status, duration, error);

          if ((response.status === 429 || response.status === 503) && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('AnalysisService', 'GET', path, response.status, duration);
        return response.text();
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Analysis Service request timeout', {
            service: 'AnalysisService',
            timeout,
            context: { path },
          });
          logApiCall('AnalysisService', 'GET', path, undefined, duration, timeoutError);

          if (attempt < this.maxRetries) {
            lastError = timeoutError;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw timeoutError;
        }

        if (error instanceof ServiceError) {
          throw error;
        }

        const networkError = new NetworkError('Analysis Service network error', {
          service: 'AnalysisService',
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('AnalysisService', 'GET', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Analysis Service request failed after retries', {
      service: 'AnalysisService',
      context: { path },
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    caches.species.clear();
    caches.diseases.clear();
    caches.dbInfo.clear();
    caches.search.clear();
    caches.pathways.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    species: ReturnType<typeof caches.species.getStats>;
    diseases: ReturnType<typeof caches.diseases.getStats>;
    dbInfo: ReturnType<typeof caches.dbInfo.getStats>;
    search: ReturnType<typeof caches.search.getStats>;
    pathways: ReturnType<typeof caches.pathways.getStats>;
  } {
    return {
      species: caches.species.getStats(),
      diseases: caches.diseases.getStats(),
      dbInfo: caches.dbInfo.getStats(),
      search: caches.search.getStats(),
      pathways: caches.pathways.getStats(),
    };
  }
}

export const analysisClient = new AnalysisClient();
