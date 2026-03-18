import {
  ReactomeError,
  ServiceError,
  ValidationError,
  NetworkError,
  TimeoutError,
  RateLimitError,
  formatErrorForLLM,
  isRetryable,
} from '../../utils/errors.js';

describe('Error Classes', () => {
  describe('ReactomeError', () => {
    it('creates error with message and context', () => {
      const context = { endpoint: 'test', requestId: '123' };
      const error = new ReactomeError('Test error', { context });

      expect(error.message).toBe('Test error');
      expect(error.name).toBe('ReactomeError');
      expect(error.context).toEqual(context);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('serializes to JSON', () => {
      const error = new ReactomeError('Test error', { statusCode: 500 });
      const json = error.toJSON();

      expect(json.name).toBe('ReactomeError');
      expect(json.message).toBe('Test error');
      expect(json.statusCode).toBe(500);
      expect(json.timestamp).toBeDefined();
    });

    it('preserves original error cause', () => {
      const originalError = new Error('Original error');
      const error = new ReactomeError('Wrapped error', { cause: originalError });

      expect(error.originalError).toBe(originalError);
      expect(error.originalError?.message).toBe('Original error');
    });
  });

  describe('ServiceError', () => {
    it('creates service error with retryable determination', () => {
      const error = new ServiceError('API failed', {
        service: 'ContentService',
        statusCode: 503,
        path: '/test',
        method: 'GET',
      });

      expect(error.message).toBe('API failed');
      expect(error.name).toBe('ServiceError');
      expect(error.service).toBe('ContentService');
      expect(error.statusCode).toBe(503);
      expect(error.retryable).toBe(true);
    });

    it('marks 404 as not retryable', () => {
      const error = new ServiceError('Not found', { statusCode: 404 });
      expect(error.retryable).toBe(false);
    });

    it('marks 429 as retryable', () => {
      const error = new ServiceError('Rate limited', { statusCode: 429 });
      expect(error.retryable).toBe(true);
    });

    it('provides actionable message for different status codes', () => {
      const notFound = new ServiceError('Failed', { statusCode: 404 });
      expect(notFound.getActionableMessage()).toContain('Resource not found');

      const badRequest = new ServiceError('Failed', { statusCode: 400 });
      expect(badRequest.getActionableMessage()).toContain('Invalid request');

      const rateLimited = new ServiceError('Failed', { statusCode: 429 });
      expect(rateLimited.getActionableMessage()).toContain('Too many requests');

      const unavailable = new ServiceError('Failed', { statusCode: 503 });
      expect(unavailable.getActionableMessage()).toContain('temporarily unavailable');
    });

    it('suggests retry for retryable errors', () => {
      const error = new ServiceError('Network error', { retryable: true });
      const message = error.getActionableMessage();
      expect(message).toContain('retrying');
    });
  });

  describe('ValidationError', () => {
    it('creates validation error with field info', () => {
      const error = new ValidationError('Invalid identifier', {
        field: 'identifiers',
        value: 'not-a-valid-id',
        rule: 'format',
      });

      expect(error.name).toBe('ValidationError');
      expect(error.field).toBe('identifiers');
      expect(error.value).toBe('not-a-valid-id');
      expect(error.rule).toBe('format');
    });

    it('serializes with field information', () => {
      const error = new ValidationError('Too many items', {
        field: 'identifiers',
        value: ['id1', 'id2'],
      });
      const json = error.toJSON();

      expect(json.name).toBe('ValidationError');
      expect(json.message).toBe('Too many items');
    });
  });

  describe('NetworkError', () => {
    it('creates network error always marked retryable', () => {
      const error = new NetworkError('Connection failed', { service: 'ContentService' });

      expect(error.name).toBe('NetworkError');
      expect(error.service).toBe('ContentService');
      expect(error.retryable).toBe(true);
      expect(error.statusCode).toBe(0);
    });

    it('preserves cause error', () => {
      const originalError = new Error('Connection refused');
      const error = new NetworkError('Network error', { cause: originalError });

      expect(error.originalError).toBe(originalError);
    });
  });

  describe('TimeoutError', () => {
    it('creates timeout error with duration', () => {
      const error = new TimeoutError('Request timeout', {
        service: 'AnalysisService',
        timeout: 15000,
      });

      expect(error.name).toBe('TimeoutError');
      expect(error.service).toBe('AnalysisService');
      expect(error.timeout).toBe(15000);
      expect(error.retryable).toBe(true);
    });
  });

  describe('RateLimitError', () => {
    it('creates rate limit error with retry info', () => {
      const error = new RateLimitError('Rate limited', {
        service: 'SearchService',
        retryAfter: 60,
      });

      expect(error.name).toBe('RateLimitError');
      expect(error.service).toBe('SearchService');
      expect(error.retryAfter).toBe(60);
      expect(error.statusCode).toBe(429);
      expect(error.retryable).toBe(true);
    });
  });

  describe('formatErrorForLLM', () => {
    it('formats ServiceError with actionable message', () => {
      const error = new ServiceError('API error', { statusCode: 404 });
      const formatted = formatErrorForLLM(error);

      expect(formatted).toContain('Resource not found');
      expect(formatted).not.toContain('retrying');
    });

    it('adds retry hint for retryable errors', () => {
      const error = new ServiceError('API error', { statusCode: 503 });
      const formatted = formatErrorForLLM(error);

      expect(formatted).toContain('retrying');
    });

    it('formats ValidationError with field context', () => {
      const error = new ValidationError('Invalid input', { field: 'species' });
      const formatted = formatErrorForLLM(error);

      expect(formatted).toContain('species');
    });

    it('handles generic ReactomeError', () => {
      const error = new ReactomeError('Something went wrong');
      const formatted = formatErrorForLLM(error);

      expect(formatted).toBe('Something went wrong');
    });

    it('handles generic Error', () => {
      const error = new Error('Unknown error');
      const formatted = formatErrorForLLM(error);

      expect(formatted).toBe('Unknown error');
    });
  });

  describe('isRetryable', () => {
    it('returns true for ServiceError with retryable flag', () => {
      const error = new ServiceError('Error', { retryable: true });
      expect(isRetryable(error)).toBe(true);
    });

    it('returns false for ServiceError without retryable flag', () => {
      const error = new ServiceError('Error', { retryable: false });
      expect(isRetryable(error)).toBe(false);
    });

    it('returns true for NetworkError', () => {
      const error = new NetworkError('Error');
      expect(isRetryable(error)).toBe(true);
    });

    it('returns true for TimeoutError', () => {
      const error = new TimeoutError('Error');
      expect(isRetryable(error)).toBe(true);
    });

    it('returns false for non-error types', () => {
      expect(isRetryable('not an error')).toBe(false);
      expect(isRetryable(null)).toBe(false);
      expect(isRetryable(undefined)).toBe(false);
    });
  });
});
