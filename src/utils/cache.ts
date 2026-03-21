/**
 * TTL-based in-memory cache for Reactome MCP
 * Automatically expires entries after specified duration
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Generic TTL-based cache
 */
export class Cache<K extends string, V> {
  private entries: Map<K, CacheEntry<V>> = new Map();
  private ttlMs: number; // Time to live in milliseconds
  private timers: Map<K, NodeJS.Timeout> = new Map();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(ttlSeconds: number = 300) {
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Get value from cache if not expired
   */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return undefined;
    }

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set value in cache with TTL
   */
  set(key: K, value: V, ttlMs?: number): void {
    // Clear existing timer if any
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const expiresAt = Date.now() + (ttlMs ?? this.ttlMs);

    this.entries.set(key, {
      value,
      expiresAt,
    });

    // Set automatic expiration
    const timer = setTimeout(() => {
      this.delete(key);
    }, ttlMs ?? this.ttlMs);

    this.timers.set(key, timer);
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete specific entry
   */
  delete(key: K): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
      this.stats.evictions++;
    }

    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.timers.forEach(timer => clearTimeout(timer));
    this.entries.clear();
    this.timers.clear();
    this.stats.evictions += this.entries.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hits: number;
    misses: number;
    evictions: number;
    hitRate: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.entries.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.evictions = 0;
  }
}

/**
 * Create cache instances for different data types
 */
export const createCaches = () => {
  return {
    // Static data - 1 hour TTL
    species: new Cache<string, unknown>(3600),
    diseases: new Cache<string, unknown>(3600),
    dbInfo: new Cache<string, unknown>(86400), // 24 hours

    // Query results - 5 minute TTL
    search: new Cache<string, unknown>(300),
    pathways: new Cache<string, unknown>(600), // 10 minutes
  };
};

// Singleton cache instances
export const caches = createCaches();
