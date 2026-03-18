import { CONTENT_SERVICE_URL, REQUEST_TIMEOUT, HEAVY_REQUEST_TIMEOUT, MAX_RETRIES, RETRY_DELAY_MS } from "../config.js";
import { ServiceError, TimeoutError, NetworkError } from "../utils/errors.js";
import { logApiCall, logCacheOperation } from "../utils/logging.js";
import { caches } from "../utils/cache.js";

export class ContentClient {
  private baseUrl: string;
  private requestTimeout: number;
  private heavyRequestTimeout: number;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(
    baseUrl: string = CONTENT_SERVICE_URL,
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

  /**
   * Get value from cache if available
   */
  private getCached<T>(cacheName: 'species' | 'diseases' | 'dbInfo', key: string): T | undefined {
    const cache = caches[cacheName];
    const startTime = Date.now();
    const cached = cache.get(key as any) as T | undefined;
    const duration = Date.now() - startTime;

    logCacheOperation('get', `${cacheName}:${key}`, !!cached, duration);
    return cached;
  }

  /**
   * Set value in cache
   */
  private setCached<T>(cacheName: 'species' | 'diseases' | 'dbInfo', key: string, value: T): void {
    const cache = caches[cacheName];
    cache.set(key as any, value);
    logCacheOperation('set', `${cacheName}:${key}`, undefined, undefined);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { isHeavy?: boolean }
  ): Promise<T> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;

    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relativePath, this.baseUrl);

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
          headers: { Accept: "application/json" },
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const text = await response.text();
          const isRetryable = response.status === 429 || response.status === 503;
          const error = new ServiceError(`Content Service error ${response.status}`, {
            service: 'ContentService',
            path,
            method: 'GET',
            statusCode: response.status,
            retryable: isRetryable,
            context: { endpoint: url.toString(), textError: text },
          });

          logApiCall('ContentService', 'GET', path, response.status, duration, error);

          if (isRetryable && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('ContentService', 'GET', path, response.status, duration);
        return response.json() as Promise<T>;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Content Service request timeout', {
            service: 'ContentService',
            timeout: this.requestTimeout,
            context: { endpoint: url.toString(), attempt },
          });
          logApiCall('ContentService', 'GET', path, undefined, duration, timeoutError);

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

        const networkError = new NetworkError('Content Service network error', {
          service: 'ContentService',
          context: { endpoint: url.toString(), attempt },
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('ContentService', 'GET', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Content Service request failed after retries', {
      service: 'ContentService',
      context: { path, attempts: this.maxRetries + 1 },
    });
  }

  async post<T>(
    path: string,
    body: unknown,
    params?: Record<string, string | number | boolean | undefined>,
    options?: { isHeavy?: boolean }
  ): Promise<T> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;

    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relativePath, this.baseUrl);

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
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const text = await response.text();
          const isRetryable = response.status === 429 || response.status === 503;
          const error = new ServiceError(`Content Service error ${response.status}`, {
            service: 'ContentService',
            path,
            method: 'POST',
            statusCode: response.status,
            retryable: isRetryable,
            context: { endpoint: url.toString(), textError: text },
          });

          logApiCall('ContentService', 'POST', path, response.status, duration, error);

          if (isRetryable && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('ContentService', 'POST', path, response.status, duration);
        return response.json() as Promise<T>;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Content Service request timeout', {
            service: 'ContentService',
            timeout: this.requestTimeout,
            context: { endpoint: url.toString(), attempt },
          });
          logApiCall('ContentService', 'POST', path, undefined, duration, timeoutError);

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

        const networkError = new NetworkError('Content Service network error', {
          service: 'ContentService',
          context: { endpoint: url.toString(), attempt },
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('ContentService', 'POST', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Content Service request failed after retries', {
      service: 'ContentService',
      context: { path, attempts: this.maxRetries + 1 },
    });
  }

  async getText(path: string, options?: { isHeavy?: boolean }): Promise<string> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;

    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relativePath, this.baseUrl);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'text/plain' },
        });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const error = new ServiceError(`Content Service error ${response.status}`, {
            service: 'ContentService',
            path,
            method: 'GET',
            statusCode: response.status,
            retryable: response.status === 429 || response.status === 503,
          });

          logApiCall('ContentService', 'GET', path, response.status, duration, error);

          if ((response.status === 429 || response.status === 503) && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('ContentService', 'GET', path, response.status, duration);
        return response.text();
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Content Service request timeout', {
            service: 'ContentService',
            timeout,
            context: { path },
          });
          logApiCall('ContentService', 'GET', path, undefined, duration, timeoutError);

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

        const networkError = new NetworkError('Content Service network error', {
          service: 'ContentService',
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('ContentService', 'GET', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Content Service request failed after retries', {
      service: 'ContentService',
      context: { path },
    });
  }

  async getBinary(path: string, options?: { isHeavy?: boolean }): Promise<Buffer> {
    const startTime = Date.now();
    const timeout = options?.isHeavy ? this.heavyRequestTimeout : this.requestTimeout;

    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relativePath, this.baseUrl);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url.toString(), { signal: controller.signal });

        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        if (!response.ok) {
          const error = new ServiceError(`Content Service error ${response.status}`, {
            service: 'ContentService',
            path,
            method: 'GET',
            statusCode: response.status,
            retryable: response.status === 429 || response.status === 503,
          });

          logApiCall('ContentService', 'GET', path, response.status, duration, error);

          if ((response.status === 429 || response.status === 503) && attempt < this.maxRetries) {
            lastError = error;
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }

          throw error;
        }

        logApiCall('ContentService', 'GET', path, response.status, duration);
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = new TimeoutError('Content Service request timeout', {
            service: 'ContentService',
            timeout,
            context: { path },
          });
          logApiCall('ContentService', 'GET', path, undefined, duration, timeoutError);

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

        const networkError = new NetworkError('Content Service network error', {
          service: 'ContentService',
          cause: error instanceof Error ? error : undefined,
        });

        logApiCall('ContentService', 'GET', path, undefined, duration, networkError);

        if (attempt < this.maxRetries) {
          lastError = networkError;
          await this.delay(this.retryDelayMs * (attempt + 1));
          continue;
        }

        throw networkError;
      }
    }

    throw lastError || new ServiceError('Content Service request failed after retries', {
      service: 'ContentService',
      context: { path },
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all species (cached for 1 hour)
   */
  async getSpecies<T>(): Promise<T> {
    // Check cache first
    const cached = this.getCached<T>('species', 'all');
    if (cached) {
      return cached;
    }

    // Fetch from API
    const result = await this.get<T>('/species');

    // Cache result
    this.setCached<T>('species', 'all', result);

    return result;
  }

  /**
   * Get all diseases (cached for 1 hour)
   */
  async getDiseases<T>(): Promise<T> {
    // Check cache first
    const cached = this.getCached<T>('diseases', 'all');
    if (cached) {
      return cached;
    }

    // Fetch from API
    const result = await this.get<T>('/diseases');

    // Cache result
    this.setCached<T>('diseases', 'all', result);

    return result;
  }

  /**
   * Get database information (cached for 24 hours)
   */
  async getDatabaseInfo<T>(): Promise<T> {
    // Check cache first
    const cached = this.getCached<T>('dbInfo', 'current');
    if (cached) {
      return cached;
    }

    // Fetch from API
    const result = await this.get<T>('/databaseName');

    // Cache result
    this.setCached<T>('dbInfo', 'current', result);

    return result;
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

export const contentClient = new ContentClient();
