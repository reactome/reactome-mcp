import { logger } from "../logger.js";

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 300;
const MAX_DELAY_MS = 5000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_DELAY_MS);
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.min(dateMs - Date.now(), MAX_DELAY_MS));
  }
  return null;
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = Math.random() * 0.3 * exp;
  return Math.floor(exp + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface FetchWithRetryOptions extends RequestInit {
  service?: string;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const { service = "http", ...init } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, init);

      if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS - 1) {
        return response;
      }

      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const delay = retryAfterMs ?? backoffDelay(attempt);
      logger.warn(`${service} transient error, retrying`, {
        url,
        status: response.status,
        attempt: attempt + 1,
        delayMs: delay,
      });
      await sleep(delay);
      continue;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS - 1) break;
      const delay = backoffDelay(attempt);
      logger.warn(`${service} network error, retrying`, {
        url,
        error: error instanceof Error ? error.message : String(error),
        attempt: attempt + 1,
        delayMs: delay,
      });
      await sleep(delay);
    }
  }

  // lastError is whatever fetch rejected with, which is not guaranteed to be
  // an Error. Normalise so callers can always read `.message`.
  const describe = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value) ?? Object.prototype.toString.call(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  };
  if (lastError instanceof Error) throw lastError;
  throw new Error(
    lastError === undefined
      ? `${service} request failed after ${MAX_ATTEMPTS} attempts`
      : `${service} request failed after ${MAX_ATTEMPTS} attempts: ${describe(lastError)}`
  );
}
