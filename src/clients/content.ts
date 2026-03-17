import { CONTENT_SERVICE_URL, REQUEST_TIMEOUT, HEAVY_REQUEST_TIMEOUT, MAX_RETRIES, RETRY_DELAY_MS } from "../config.js";
import { ServiceError, TimeoutError, NetworkError } from "../utils/errors.js";
import { logApiCall } from "../utils/logging.js";

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
}

export const contentClient = new ContentClient();
