import { Cache, createCaches, caches } from '../../utils/cache.js';

describe('Cache', () => {
  let cache: Cache<string, string>;

  beforeEach(() => {
    cache = new Cache<string, string>(3600);
  });

  afterEach(() => {
    cache.clear();
  });

  it('stores and retrieves values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('checks if key exists', () => {
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('nonexistent')).toBe(false);
  });

  it('deletes entries', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.delete('key1');

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');
  });

  it('clears all entries', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });

  it('tracks cache hits', () => {
    cache.set('key1', 'value1');
    cache.get('key1');
    cache.get('key1');
    cache.get('key2');

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
  });

  it('calculates hit rate', () => {
    cache.set('key1', 'value1');
    cache.get('key1');
    cache.get('key1');
    cache.get('key2');

    const stats = cache.getStats();
    expect(stats.hitRate).toBe(2 / 3);
  });

  it('tracks cache size', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    let stats = cache.getStats();
    expect(stats.size).toBe(2);

    cache.delete('key1');
    stats = cache.getStats();
    expect(stats.size).toBe(1);
  });

  it('resets statistics', () => {
    cache.set('key1', 'value1');
    cache.get('key1');
    cache.get('key2');

    let stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);

    cache.resetStats();
    stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it('caches objects', () => {
    const objectCache = new Cache<string, { id: number; name: string }>(300);
    const obj = { id: 1, name: 'Test' };
    objectCache.set('obj1', obj);

    expect(objectCache.get('obj1')).toEqual(obj);
  });

  it('caches arrays', () => {
    const arrayCache = new Cache<string, number[]>(300);
    const arr = [1, 2, 3, 4, 5];
    arrayCache.set('arr1', arr);

    expect(arrayCache.get('arr1')).toEqual(arr);
  });

  it('handles null values', () => {
    const cache = new Cache<string, null>(300);
    cache.set('null', null);
    expect(cache.get('null')).toBeNull();
  });

  it('handles empty strings', () => {
    cache.set('' as string, '');
    expect(cache.get('' as string)).toBe('');
  });

  it('handles large cache', () => {
    const largeCache = new Cache<string, number>(3600);
    for (let i = 0; i < 1000; i++) {
      largeCache.set(`key${i}`, i);
    }

    expect(largeCache.get('key500')).toBe(500);
    const stats = largeCache.getStats();
    expect(stats.size).toBe(1000);
  });
});

describe('Cache Factory', () => {
  it('creates cache instances', () => {
    const caches = createCaches();
    expect(caches.species).toBeInstanceOf(Cache);
    expect(caches.diseases).toBeInstanceOf(Cache);
    expect(caches.dbInfo).toBeInstanceOf(Cache);
    expect(caches.search).toBeInstanceOf(Cache);
    expect(caches.pathways).toBeInstanceOf(Cache);
  });

  it('creates independent cache instances', () => {
    const caches = createCaches();
    caches.species.set('test', { name: 'species' });
    caches.search.set('test', { query: 'search' });

    expect(caches.species.get('test')).toEqual({ name: 'species' });
    expect(caches.search.get('test')).toEqual({ query: 'search' });
  });
});

describe('Singleton Caches', () => {
  afterEach(() => {
    caches.species.clear();
    caches.diseases.clear();
    caches.dbInfo.clear();
    caches.search.clear();
    caches.pathways.clear();
  });

  it('provides singleton instances', () => {
    expect(caches.species).toBeInstanceOf(Cache);
    expect(caches.diseases).toBeInstanceOf(Cache);
  });

  it('caches persist across accesses', () => {
    caches.species.set('human', { name: 'Homo sapiens' });
    expect(caches.species.get('human')).toEqual({ name: 'Homo sapiens' });
  });

  it('allows clearing specific caches', () => {
    caches.species.set('key1', { data: 'species' });
    caches.search.set('key1', { data: 'search' });

    caches.species.clear();

    expect(caches.species.get('key1')).toBeUndefined();
    expect(caches.search.get('key1')).toEqual({ data: 'search' });
  });
});
