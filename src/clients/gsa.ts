import { GSA_SERVICE_URL } from "../config.js";
import { fetchWithRetry } from "./http.js";

/**
 * ReactomeGSA (gsa.reactome.org), the gene set analysis service.
 *
 * Separate from the Analysis Service in every respect that matters: a
 * different host, a different API, and a different analysis. Over-representation
 * takes a list of identifiers; gene set analysis takes an expression matrix
 * with sample groups. Conflating them is the mistake this client exists to stop
 * the model making.
 */
export class GsaClient {
  private baseUrl: string;

  constructor(baseUrl: string = GSA_SERVICE_URL) {
    this.baseUrl = baseUrl;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.set(key, String(value));
      });
    }
    return url;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const response = await fetchWithRetry(this.buildUrl(path, params).toString(), {
      service: "gsa",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GSA Service error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }
}

export const gsaClient = new GsaClient();
