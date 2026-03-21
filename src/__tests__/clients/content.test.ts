import { ContentClient } from '../../clients/content.js';
import { ServiceError, NetworkError } from '../../utils/errors.js';

describe('ContentClient', () => {
  let client: ContentClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ContentClient('http://localhost:8080/ContentService/');
  });

  describe('Initialization', () => {
    it('creates client with default baseUrl', () => {
      const defaultClient = new ContentClient();
      expect(defaultClient).toBeInstanceOf(ContentClient);
    });

    it('creates client with custom baseUrl', () => {
      const customClient = new ContentClient('http://custom:9000/');
      expect(customClient).toBeInstanceOf(ContentClient);
    });

    it('accepts custom timeout options', () => {
      const customClient = new ContentClient('http://localhost/', {
        requestTimeout: 5000,
        heavyRequestTimeout: 30000,
        maxRetries: 5,
        retryDelayMs: 500,
      });
      expect(customClient).toBeInstanceOf(ContentClient);
    });
  });

  describe('GET requests', () => {
    it('makes successful GET request and returns JSON', async () => {
      const mockData = { id: 1, name: 'Species 1' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce(mockData),
      });

      const result = await client.get<typeof mockData>('/species');

      expect(result).toEqual(mockData);
    });

    it('builds correct URL with path', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.get('/species');

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('/species');
      expect(callUrl).toContain('localhost:8080');
    });

    it('includes query parameters in URL', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.get('/pathway', { page: 1, size: 25 });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('page=1');
      expect(callUrl).toContain('size=25');
    });

    it('omits undefined parameters', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.get('/pathway', { page: 1, filter: undefined });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('page=1');
      expect(callUrl).not.toContain('filter');
    });

    it('throws ServiceError on 404 status', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValueOnce('Not found'),
      });

      try {
        await client.get('/pathway/invalid');
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).statusCode).toBe(404);
      }
    });

    it('throws ServiceError on 500 status', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValueOnce('Server error'),
      });

      try {
        await client.get('/pathway');
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).statusCode).toBe(500);
      }
    });

    it('throws NetworkError on network failure', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network failed'));

      try {
        await client.get('/species');
        fail('Should throw NetworkError');
      } catch (error) {
        expect(error).toBeInstanceOf(NetworkError);
      }
    });

    it('normalizes path with leading slash', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.get('/species');
      const url1 = (global.fetch as jest.Mock).mock.calls[0][0];

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.get('species');
      const url2 = (global.fetch as jest.Mock).mock.calls[0][0];

      expect(url1).toEqual(url2);
    });
  });

  describe('POST requests', () => {
    it('sends POST request with JSON body', async () => {
      const body = { data: 'test' };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.post('/update', body);

      expect(global.fetch).toHaveBeenCalledWith(expect.any(String), {
        signal: expect.any(AbortSignal),
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(body),
      });
    });

    it('includes query params in POST URL', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({}),
      });

      await client.post('/update', {}, { format: 'json' });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('format=json');
    });

    it('throws ServiceError on POST failure', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValueOnce('Bad request'),
      });

      try {
        await client.post('/update', {});
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).statusCode).toBe(400);
      }
    });
  });

  describe('getText requests', () => {
    it('retrieves plain text content', async () => {
      const textContent = 'Plain text response';
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValueOnce(textContent),
      });

      const result = await client.getText('/info');

      expect(result).toBe(textContent);
    });

    it('throws ServiceError on getText failure', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      try {
        await client.getText('/missing');
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
      }
    });
  });

  describe('getBinary requests', () => {
    it('retrieves binary content as Buffer', async () => {
      const mockBuffer = Buffer.from([1, 2, 3, 4]);
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: jest.fn().mockResolvedValueOnce(mockBuffer.buffer),
      });

      const result = await client.getBinary('/image.png');

      expect(result).toBeInstanceOf(Buffer);
    });

    it('throws ServiceError on getBinary failure', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      try {
        await client.getBinary('/image.png');
        fail('Should throw ServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
      }
    });
  });

  describe('Error context', () => {
    it('includes endpoint in ServiceError context', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValueOnce('Bad request'),
      });

      try {
        await client.get('/test');
        fail('Should throw');
      } catch (error) {
        const serviceError = error as ServiceError;
        expect(serviceError.context.endpoint).toBeDefined();
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
