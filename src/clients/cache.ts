/**
 * TTL-based in-memory cache layer
 * Wraps clients to provide caching with automatic expiration
 */

import type { CacheEntry } from "../types/unified.js";

/**
 * Cache manager with TTL support
 */
export class CacheManager {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private defaultTtl: number;
  private maxSize: number;
  private evictionPolicy: "LRU" | "FIFO" = "LRU"; // Least Recently Used by default

  constructor(defaultTtlMs: number = 5 * 60 * 1000, maxSize: number = 1000) {
    this.defaultTtl = defaultTtlMs;
    this.maxSize = maxSize;

    // Cleanup expired entries every 60 seconds
    setInterval(() => this.cleanupExpired(), 60 * 1000);
  }

  /**
   * Get value from cache if not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Update hit count for LRU tracking
    entry.hits++;
    return entry.value;
  }

  /**
   * Set value in cache with optional TTL override
   */
  set<T>(key: string, value: T, ttlMs?: number, source?: string): void {
    // Check cache size and evict if necessary
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: ttlMs ?? this.defaultTtl,
      hits: 0,
      source,
    };

    this.cache.set(key, entry);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  stats(): {
    size: number;
    maxSize: number;
    entries: Array<{
      key: string;
      hits: number;
      ageMs: number;
      source?: string;
    }>;
  } {
    const entries: Array<{
      key: string;
      hits: number;
      ageMs: number;
      source?: string;
    }> = [];

    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      entries.push({
        key,
        hits: entry.hits,
        ageMs: now - entry.timestamp,
        source: entry.source,
      });
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      entries: entries.sort((a, b) => b.hits - a.hits),
    };
  }

  /**
   * Remove expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        toDelete.push(key);
      }
    }

    toDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Evict least recently used entry
   */
  private evict(): void {
    if (this.evictionPolicy === "LRU") {
      let lruKey: string | null = null;
      let minHits = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.hits < minHits) {
          minHits = entry.hits;
          lruKey = key;
        }
      }

      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }
  }
}

/**
 * Global cache instance
 */
export const globalCache = new CacheManager();

/**
 * Helper function to generate cache key from parameters
 */
export function generateCacheKey(prefix: string, params: Record<string, unknown>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${JSON.stringify(params[key])}`)
    .join("&");

  return `${prefix}:${sortedParams}`;
}

/**
 * Wrapper for cached API calls
 */
export async function cachedCall<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs?: number,
  source?: string
): Promise<{ value: T; cached: boolean }> {
  // Try to get from cache
  const cached = globalCache.get<T>(key);
  if (cached !== null) {
    return { value: cached, cached: true };
  }

  // Fetch fresh data
  const value = await fetchFn();

  // Store in cache
  globalCache.set(key, value, ttlMs, source);

  return { value, cached: false };
}
