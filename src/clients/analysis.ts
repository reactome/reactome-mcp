import { ANALYSIS_SERVICE_URL } from "../config.js";
import { fetchWithRetry } from "./http.js";

export class AnalysisClient {
  private baseUrl: string;

  constructor(baseUrl: string = ANALYSIS_SERVICE_URL) {
    this.baseUrl = baseUrl;
  }

  private resolvePath(path: string): URL {
    const relativePath = path.startsWith("/") ? path.slice(1) : path;
    return new URL(relativePath, this.baseUrl);
  }

  private applyParams(url: URL, params?: Record<string, string | number | boolean | undefined>) {
    if (!params) return;
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.resolvePath(path);
    this.applyParams(url, params);

    const response = await fetchWithRetry(url.toString(), {
      service: "analysis",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Analysis Service error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async postIdentifiers<T>(
    path: string,
    identifiers: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url = this.resolvePath(path);
    this.applyParams(url, params);

    const response = await fetchWithRetry(url.toString(), {
      service: "analysis",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "text/plain",
      },
      body: identifiers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Analysis Service error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async postJson<T>(
    path: string,
    body: unknown,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url = this.resolvePath(path);
    this.applyParams(url, params);

    const response = await fetchWithRetry(url.toString(), {
      service: "analysis",
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "text/plain",
      },
      body: String(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Analysis Service error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async getBinary(path: string): Promise<Buffer> {
    const url = this.resolvePath(path);
    const response = await fetchWithRetry(url.toString(), { service: "analysis" });

    if (!response.ok) {
      throw new Error(`Analysis Service error ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async getCsv(path: string): Promise<string> {
    const url = this.resolvePath(path);
    const response = await fetchWithRetry(url.toString(), {
      service: "analysis",
      headers: { Accept: "text/csv" },
    });

    if (!response.ok) {
      throw new Error(`Analysis Service error ${response.status}`);
    }

    return response.text();
  }
}

export const analysisClient = new AnalysisClient();
