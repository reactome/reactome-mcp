import { CONTENT_SERVICE_URL } from "../config.js";
import { fetchWithRetry } from "./http.js";

export class ContentClient {
  private baseUrl: string;

  constructor(baseUrl: string = CONTENT_SERVICE_URL) {
    this.baseUrl = baseUrl;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): URL {
    const relativePath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(relativePath, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    return url;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    const response = await fetchWithRetry(url.toString(), {
      service: "content",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Content Service error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    const response = await fetchWithRetry(url.toString(), {
      service: "content",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Content Service error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getText(path: string): Promise<string> {
    const url = this.buildUrl(path);
    const response = await fetchWithRetry(url.toString(), {
      service: "content",
      headers: { Accept: "text/plain" },
    });

    if (!response.ok) {
      throw new Error(`Content Service error ${response.status}`);
    }

    return response.text();
  }

  async getBinary(path: string): Promise<Buffer> {
    const url = this.buildUrl(path);
    const response = await fetchWithRetry(url.toString(), { service: "content" });

    if (!response.ok) {
      throw new Error(`Content Service error ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export const contentClient = new ContentClient();
