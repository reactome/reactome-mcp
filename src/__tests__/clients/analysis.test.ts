import { AnalysisClient } from '../../clients/analysis.js';
import { ServiceError, NetworkError } from '../../utils/errors.js';

describe('AnalysisClient', () => {
  let client: AnalysisClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new AnalysisClient('http://localhost:8080/AnalysisService/');
  });

  describe('Initialization', () => {
    it('creates client with default baseUrl', () => {
      const defaultClient = new AnalysisClient();
      expect(defaultClient).toBeInstanceOf(AnalysisClient);
    });

    it('creates client with custom baseUrl', () => {
      const customClient = new AnalysisClient('http://custom:9000/');
      expect(customClient).toBeInstanceOf(AnalysisClient);
    });

    it('accepts custom timeout options', () => {
      const customClient = new AnalysisClient('http://localhost/', {
        requestTimeout: 5000,
        heavyRequestTimeout: 60000,
        maxRetries: 5,
        retryDelayMs: 500,
      });
      expect(customClient).toBeInstanceOf(AnalysisClient);
    });
  });

  describe('GET requests', () => {
    it('makes successful GET request', async () => {
      const mockData = { status: 'completed' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce(mockData),
      });

      const result = await client.get<typeof mockData>('/token/ABC123');

      expect(result).toEqual(mockData);
    });

    it('includes query parameters', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.get('/token/ABC', { projection: true, interactors: true });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('projection=true');
      expect(callUrl).toContain('interactors=true');
    });

    it('throws ServiceError on error', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValueOnce('Not found'),
      });

      try {
        await client.get('/token/INVALID');
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).statusCode).toBe(404);
      }
    });
  });

  describe('postIdentifiers requests', () => {
    it('sends identifiers as plain text body', async () => {
      const identifiers = 'TP53\nBRCA1\nEGFR';
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({ summary: { found: 3 } }),
      });

      const result = await client.postIdentifiers('/identifiers', identifiers);

      expect(result).toEqual({ summary: { found: 3 } });
      expect(global.fetch).toHaveBeenCalledWith(expect.any(String), {
        signal: expect.any(AbortSignal),
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'text/plain',
        }),
        body: identifiers,
      });
    });

    it('includes query parameters with postIdentifiers', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.postIdentifiers('/identifiers', 'TP53', { projection: true });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('projection=true');
    });

    it('throws ServiceError on postIdentifiers failure', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValueOnce('Server error'),
      });

      try {
        await client.postIdentifiers('/identifiers', 'INVALID');
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).statusCode).toBe(500);
      }
    });
  });

  describe('postJson requests', () => {
    it('sends JSON body as plain text', async () => {
      const body = { query: 'test' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.postJson('/query', body);

      expect(global.fetch).toHaveBeenCalledWith(expect.any(String), {
        signal: expect.any(AbortSignal),
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'text/plain',
        }),
        body: String(body),
      });
    });

    it('includes query parameters in postJson', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.postJson('/query', {}, { format: 'json' });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('format=json');
    });
  });

  describe('getBinary requests', () => {
    it('retrieves binary diagram', async () => {
      const mockBuffer = Buffer.from([137, 80, 78, 71]); // PNG signature
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: jest.fn().mockResolvedValueOnce(mockBuffer.buffer),
      });

      const result = await client.getBinary('/diagram/ABC123.png');

      expect(result).toBeInstanceOf(Buffer);
    });

    it('throws ServiceError on getBinary failure', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      try {
        await client.getBinary('/diagram/missing.png');
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
      }
    });
  });

  describe('getCsv requests', () => {
    it('retrieves CSV export', async () => {
      const csvData = 'id,name,pvalue\nR-HSA-123,Pathway 1,0.001';
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValueOnce(csvData),
      });

      const result = await client.getCsv('/token/ABC123/export');

      expect(result).toBe(csvData);
      expect(global.fetch).toHaveBeenCalledWith(expect.any(String), {
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          'Accept': 'text/csv',
        }),
      });
    });

    it('throws ServiceError on getCsv failure', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      try {
        await client.getCsv('/token/INVALID/export');
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
      }
    });
  });

  describe('Path handling', () => {
    it('normalizes paths with leading slash', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.get('/token/ABC');
      const url1 = (global.fetch as jest.Mock).mock.calls[0][0];

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.get('token/ABC');
      const url2 = (global.fetch as jest.Mock).mock.calls[0][0];

      expect(url1).toEqual(url2);
    });
  });

  describe('Error handling', () => {
    it('throws NetworkError on network failure', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Connection refused'));

      try {
        await client.get('/status');
        fail('Should throw NetworkError');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
      }
    });

    it('preserves error details in ServiceError', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValueOnce('Bad request details'),
      });

      try {
        await client.get('/invalid');
        fail('Should throw');
      } catch (error) {
        const serviceError = error as ServiceError;
        expect(serviceError.context).toBeDefined();
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
