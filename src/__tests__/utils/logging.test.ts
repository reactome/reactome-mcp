import logger, {
  createToolLogger,
  logApiCall,
  logCacheOperation,
  logValidationError,
  logRateLimit,
} from '../../utils/logging.js';

// Mock console.error to capture logs
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

describe('Logging System', () => {
  beforeEach(() => {
    mockConsoleError.mockClear();
  });

  afterAll(() => {
    mockConsoleError.mockRestore();
  });

  describe('Logger class', () => {
    it('logs at debug level', () => {
      logger.setLevel('debug');
      logger.debug('Debug message', { context: 'value' });

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('debug');
      expect(parsed.message).toBe('Debug message');
      expect(parsed.context).toBe('value');
    });

    it('logs at info level', () => {
      logger.setLevel('info');
      logger.info('Info message');

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('Info message');
    });

    it('logs at warn level', () => {
      logger.setLevel('debug');
      logger.warn('Warning message', { severity: 'high' });

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('warn');
      expect(parsed.severity).toBe('high');
    });

    it('logs at error level', () => {
      logger.setLevel('error');
      logger.error('Error message', { code: 'ERR_123' });

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.level).toBe('error');
      expect(parsed.code).toBe('ERR_123');
    });

    it('respects minimum log level', () => {
      logger.setLevel('warn');
      mockConsoleError.mockClear();

      logger.debug('Debug message'); // Should not log
      expect(mockConsoleError).not.toHaveBeenCalled();

      logger.warn('Warning message'); // Should log
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('includes timestamp in logs', () => {
      logger.setLevel('debug');
      logger.info('Test message');

      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.timestamp).toBeDefined();
      expect(new Date(parsed.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('Tool Logger', () => {
    it('logs tool execution start', () => {
      logger.setLevel('debug');
      const toolLogger = createToolLogger('test_tool');

      mockConsoleError.mockClear();
      const startTime = toolLogger.start({ param1: 'value1' });

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.event).toBe('tool_start');
      expect(parsed.tool).toBe('test_tool');
      expect(parsed.message).toContain('test_tool');
      expect(typeof startTime).toBe('number');
    });

    it('logs tool execution success with duration', () => {
      logger.setLevel('info');
      const toolLogger = createToolLogger('analyze_tool');

      mockConsoleError.mockClear();
      const startTime = Date.now();
      // Simulate some work
      const endTime = startTime + 100;
      jest.useFakeTimers();
      jest.setSystemTime(endTime);

      toolLogger.success(startTime, 50); // 50 results

      jest.useRealTimers();
      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.event).toBe('tool_success');
      expect(parsed.tool).toBe('analyze_tool');
      expect(parsed.duration).toBeGreaterThan(0);
      expect(parsed.resultSize).toBe(50);
    });

    it('logs tool execution error with context', () => {
      logger.setLevel('info');
      const toolLogger = createToolLogger('search_tool');

      mockConsoleError.mockClear();
      const startTime = Date.now();
      const error = new Error('API failed');

      toolLogger.error(startTime, error, { query: 'test' });

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.event).toBe('tool_error');
      expect(parsed.tool).toBe('search_tool');
      expect(parsed.error).toBe('API failed');
      expect(parsed.errorType).toBe('Error');
      expect(parsed.query).toBe('test');
    });
  });

  describe('API Call Logging', () => {
    it('logs successful API call', () => {
      logger.setLevel('debug');

      mockConsoleError.mockClear();
      logApiCall('ContentService', 'GET', '/species', 200, 150);

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.service).toBe('ContentService');
      expect(parsed.method).toBe('GET');
      expect(parsed.path).toBe('/species');
      expect(parsed.statusCode).toBe(200);
      expect(parsed.duration).toBe(150);
      expect(parsed.event).toBe('api_call_success');
    });

    it('logs failed API call', () => {
      logger.setLevel('warn');

      mockConsoleError.mockClear();
      const error = new Error('Connection refused');
      logApiCall('AnalysisService', 'POST', '/identifiers', 500, 2000, error);

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.service).toBe('AnalysisService');
      expect(parsed.method).toBe('POST');
      expect(parsed.statusCode).toBe(500);
      expect(parsed.error).toBe('Connection refused');
      expect(parsed.event).toBe('api_call_failed');
    });
  });

  describe('Cache Operation Logging', () => {
    it('logs cache get operation', () => {
      logger.setLevel('debug');

      mockConsoleError.mockClear();
      logCacheOperation('get', 'species-list', true, 10);

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.operation).toBe('get');
      expect(parsed.key).toBe('species-list');
      expect(parsed.hit).toBe(true);
      expect(parsed.duration).toBe(10);
      expect(parsed.event).toBe('cache_operation');
    });

    it('logs cache miss', () => {
      logger.setLevel('debug');

      mockConsoleError.mockClear();
      logCacheOperation('get', 'query-xyz', false, 5);

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.hit).toBe(false);
    });
  });

  describe('Validation Error Logging', () => {
    it('logs validation error with field context', () => {
      logger.setLevel('warn');

      mockConsoleError.mockClear();
      logValidationError('identifiers', 'exceeds maximum size', ['id1', 'id2']);

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.field).toBe('identifiers');
      expect(parsed.reason).toBe('exceeds maximum size');
      expect(parsed.event).toBe('validation_error');
    });

    it('handles object values in validation logs', () => {
      logger.setLevel('warn');

      mockConsoleError.mockClear();
      logValidationError('params', 'invalid type', { nested: 'object' });

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.value).toBe('[object]');
    });
  });

  describe('Rate Limit Logging', () => {
    it('logs rate limit exceeded', () => {
      logger.setLevel('warn');

      mockConsoleError.mockClear();
      logRateLimit('analyze_identifiers', 10, 60);

      expect(mockConsoleError).toHaveBeenCalled();
      const output = mockConsoleError.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.tool).toBe('analyze_identifiers');
      expect(parsed.limit).toBe(10);
      expect(parsed.window).toBe(60);
      expect(parsed.event).toBe('rate_limit_exceeded');
    });
  });
});
