/**
 * Streamable HTTP transport.
 *
 * stdio cannot be put behind a reverse proxy, so a hosted instance needs this.
 * These tests run a real server on an ephemeral port and speak real HTTP to it
 * -- the session lifecycle is the part worth testing, and a mock of it would be
 * testing the mock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startHttpServer } from "../src/http.js";

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "vitest", version: "0" },
  },
};

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

describe("streamable http transport", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    // Port 0: let the OS pick, so the suite cannot collide with whatever else
    // is listening on this machine. One already did.
    server = await startHttpServer(0, "127.0.0.1");
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  async function openSession(): Promise<string> {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(INIT),
    });
    const sessionId = res.headers.get("mcp-session-id");
    if (!sessionId) throw new Error(`no session id; status ${res.status}`);
    await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...JSON_HEADERS, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    return sessionId;
  }

  async function sessionCount(): Promise<number> {
    const res = await fetch(`${base}/health`);
    const body = (await res.json()) as { sessions: number };
    return body.sessions;
  }

  it("reports its own health without claiming Reactome is healthy", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.name).toBe("reactome");
    // This says the process is up. It deliberately does not probe the Content
    // Service, so a green health check never implies Reactome is well.
    expect(body).toHaveProperty("contentService");
  });

  it("issues a session id on initialize", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(INIT),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("refuses a request that carries no session", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });

    // Only initialize may create a session; anything else without one is a
    // client error, not a reason to make a new one.
    expect(res.status).toBe(400);
  });

  it("refuses an unknown session id", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "GET",
      headers: { Accept: "text/event-stream", "mcp-session-id": "not-a-real-session" },
    });

    expect(res.status).toBe(400);
  });

  it("serves the full tool list over HTTP", async () => {
    const sessionId = await openSession();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...JSON_HEADERS, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });

    const text = await res.text();
    const names = [...text.matchAll(/"name":"(reactome_[a-z_0-9]+)"/g)].map(m => m[1]);

    // The same surface stdio serves -- one registration path, two transports.
    expect(new Set(names).size).toBeGreaterThan(40);
    expect(names).toContain("reactome_search");
  });

  it("gives each session its own server", async () => {
    const before = await sessionCount();
    const a = await openSession();
    const b = await openSession();

    expect(a).not.toBe(b);
    expect(await sessionCount()).toBe(before + 2);
  });

  it("tears a session down on DELETE", async () => {
    const sessionId = await openSession();
    const before = await sessionCount();

    const res = await fetch(`${base}/mcp`, {
      method: "DELETE",
      headers: { "mcp-session-id": sessionId },
    });
    expect(res.status).toBeLessThan(400);

    expect(await sessionCount()).toBe(before - 1);
  });

  it("rejects a forged Host header", async () => {
    // DNS rebinding protection: without it a page in the user's browser could
    // drive a server bound to their loopback.
    //
    // Sent with node:http rather than fetch. `Host` is a forbidden header name,
    // so fetch drops an override silently -- the first version of this test
    // passed a Host it was never actually sending, and would have passed with
    // the protection turned off.
    const { port } = server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/health",
          method: "GET",
          headers: { Host: "evil.example.com" },
        },
        res => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(403);
  });

  it("accepts the real Host header", async () => {
    // The mirror of the test above: proof the 403 is about the forged value,
    // not about node:http requests in general.
    const { port } = server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/health", method: "GET" }, res => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(200);
  });
});
