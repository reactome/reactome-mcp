import {
  CONTENT_SERVICE_URL,
  ANALYSIS_SERVICE_URL,
  REQUEST_TIMEOUT,
  HEAVY_REQUEST_TIMEOUT,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  CACHE_TTL_SPECIES,
  CACHE_TTL_DISEASES,
  CACHE_TTL_DBINFO,
  CACHE_TTL_QUERIES,
  MAX_BATCH_IDENTIFIERS,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_PAGE_SIZE,
  RATE_LIMIT_ANALYSIS,
  RATE_LIMIT_SEARCH,
  RATE_LIMIT_GENERAL,
  LOG_LEVEL,
  NODE_ENV,
  IS_PRODUCTION,
  DEFAULT_SPECIES,
  DEFAULT_PAGE_SIZE,
} from '../../config.js';

describe('Configuration', () => {
  beforeEach(() => {
    // Clear any env var overrides
    delete process.env.CONTENT_SERVICE_URL;
    delete process.env.ANALYSIS_SERVICE_URL;
    delete process.env.REQUEST_TIMEOUT;
    delete process.env.HEAVY_REQUEST_TIMEOUT;
    delete process.env.MAX_RETRIES;
    delete process.env.RETRY_DELAY_MS;
  });

  describe('API Service URLs', () => {
    it('has default Reactome Content Service URL', () => {
      expect(CONTENT_SERVICE_URL).toBe('https://reactome.org/ContentService/');
    });

    it('has default Reactome Analysis Service URL', () => {
      expect(ANALYSIS_SERVICE_URL).toBe('https://reactome.org/AnalysisService/');
    });
  });

  describe('Timeout Configuration', () => {
    it('has default request timeout of 15 seconds', () => {
      expect(REQUEST_TIMEOUT).toBe(15000);
    });

    it('has default heavy request timeout of 30 seconds', () => {
      expect(HEAVY_REQUEST_TIMEOUT).toBe(30000);
    });

    it('heavy timeout is longer than regular timeout', () => {
      expect(HEAVY_REQUEST_TIMEOUT).toBeGreaterThan(REQUEST_TIMEOUT);
    });
  });

  describe('Retry Configuration', () => {
    it('has default max retries of 3', () => {
      expect(MAX_RETRIES).toBe(3);
    });

    it('has default retry delay of 1 second', () => {
      expect(RETRY_DELAY_MS).toBe(1000);
    });
  });

  describe('Cache TTLs', () => {
    it('has species cache TTL of 1 hour', () => {
      expect(CACHE_TTL_SPECIES).toBe(3600);
    });

    it('has diseases cache TTL of 1 hour', () => {
      expect(CACHE_TTL_DISEASES).toBe(3600);
    });

    it('has database info cache TTL of 24 hours', () => {
      expect(CACHE_TTL_DBINFO).toBe(86400);
    });

    it('has query cache TTL of 5 minutes', () => {
      expect(CACHE_TTL_QUERIES).toBe(300);
    });

    it('dbinfo TTL is longer than other static data', () => {
      expect(CACHE_TTL_DBINFO).toBeGreaterThan(CACHE_TTL_SPECIES);
      expect(CACHE_TTL_DBINFO).toBeGreaterThan(CACHE_TTL_DISEASES);
    });

    it('query TTL is shorter than static data TTLs', () => {
      expect(CACHE_TTL_QUERIES).toBeLessThan(CACHE_TTL_SPECIES);
    });
  });

  describe('Input Validation Limits', () => {
    it('has max batch identifiers limit of 50000', () => {
      expect(MAX_BATCH_IDENTIFIERS).toBe(50000);
    });

    it('has max search query length of 500', () => {
      expect(MAX_SEARCH_QUERY_LENGTH).toBe(500);
    });

    it('has max page size of 100', () => {
      expect(MAX_PAGE_SIZE).toBe(100);
    });
  });

  describe('Rate Limiting', () => {
    it('has analysis rate limit of 10 requests per minute', () => {
      expect(RATE_LIMIT_ANALYSIS).toBe(10);
    });

    it('has search rate limit of 20 requests per minute', () => {
      expect(RATE_LIMIT_SEARCH).toBe(20);
    });

    it('has general rate limit of 30 requests per minute', () => {
      expect(RATE_LIMIT_GENERAL).toBe(30);
    });

    it('analysis has lower limit than search', () => {
      expect(RATE_LIMIT_ANALYSIS).toBeLessThan(RATE_LIMIT_SEARCH);
    });

    it('general has higher limit than analysis', () => {
      expect(RATE_LIMIT_GENERAL).toBeGreaterThan(RATE_LIMIT_ANALYSIS);
    });
  });

  describe('Logging Configuration', () => {
    it('has default log level of info', () => {
      expect(LOG_LEVEL).toBe('info');
    });

    it('is a valid log level', () => {
      const validLevels = ['debug', 'info', 'warn', 'error'];
      expect(validLevels).toContain(LOG_LEVEL);
    });
  });

  describe('Environment Configuration', () => {
    it('has NODE_ENV defined', () => {
      expect(NODE_ENV).toBeDefined();
    });

    it('IS_PRODUCTION reflects NODE_ENV', () => {
      if (NODE_ENV === 'production') {
        expect(IS_PRODUCTION).toBe(true);
      } else {
        expect(IS_PRODUCTION).toBe(false);
      }
    });
  });

  describe('Default Behavior', () => {
    it('has default species of Homo sapiens', () => {
      expect(DEFAULT_SPECIES).toBe('Homo sapiens');
    });

    it('has default page size of 25', () => {
      expect(DEFAULT_PAGE_SIZE).toBe(25);
    });

    it('default page size is within max bounds', () => {
      expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    });
  });

  describe('Configuration sanity checks', () => {
    it('URLs are properly formatted', () => {
      expect(CONTENT_SERVICE_URL).toMatch(/^https?:\/\//);
      expect(ANALYSIS_SERVICE_URL).toMatch(/^https?:\/\//);
    });

    it('timeouts are positive integers', () => {
      expect(REQUEST_TIMEOUT).toBeGreaterThan(0);
      expect(HEAVY_REQUEST_TIMEOUT).toBeGreaterThan(0);
    });

    it('max retries is non-negative integer', () => {
      expect(MAX_RETRIES).toBeGreaterThanOrEqual(0);
    });

    it('cache TTLs are positive integers', () => {
      expect(CACHE_TTL_SPECIES).toBeGreaterThan(0);
      expect(CACHE_TTL_DISEASES).toBeGreaterThan(0);
      expect(CACHE_TTL_DBINFO).toBeGreaterThan(0);
      expect(CACHE_TTL_QUERIES).toBeGreaterThan(0);
    });

    it('rate limits are positive integers', () => {
      expect(RATE_LIMIT_ANALYSIS).toBeGreaterThan(0);
      expect(RATE_LIMIT_SEARCH).toBeGreaterThan(0);
      expect(RATE_LIMIT_GENERAL).toBeGreaterThan(0);
    });

    it('batch size limit is reasonable', () => {
      expect(MAX_BATCH_IDENTIFIERS).toBeGreaterThan(1000);
      expect(MAX_BATCH_IDENTIFIERS).toBeLessThanOrEqual(1000000);
    });
  });
});
