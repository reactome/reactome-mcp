import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "../src/clients/http.js";

function mockResponse(status: number, body = "ok", headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe("fetchWithRetry", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it("returns a 2xx response on the first try without retrying", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(200, "hello"));
    const res = await fetchWithRetry("https://example.test");
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry on a 4xx (non-429)", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(404));
    const res = await fetchWithRetry("https://example.test");
    expect(res.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 and succeeds on the second attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200));
    const promise = fetchWithRetry("https://example.test");
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 and respects Retry-After (seconds)", async () => {
    fetchSpy
      .mockResolvedValueOnce(mockResponse(429, "slow down", { "retry-after": "2" }))
      .mockResolvedValueOnce(mockResponse(200));
    const promise = fetchWithRetry("https://example.test");
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after max attempts and returns the last response", async () => {
    fetchSpy.mockResolvedValue(mockResponse(503));
    const promise = fetchWithRetry("https://example.test");
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retries on network errors and surfaces the last error", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    const promise = fetchWithRetry("https://example.test");
    // Swallow unhandled rejection before timers advance
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("ECONNREFUSED");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
