/**
 * The two ceilings on one request, and whether they agree.
 *
 * `MAX_ANALYSIS_IDENTIFIERS` bounds how many identifiers a caller may submit.
 * The HTTP transport separately bounds how many *bytes* it will read. Neither
 * knows about the other, and for a while they disagreed: the cap was 10,000
 * identifiers, which serialise to about 180 KB, while the transport refuses
 * anything over 100 KiB. A caller at exactly the documented cap got a bare
 * 413 from express before any validation ran — so the error named the wrong
 * thing, and the cap was unreachable by the transport this server is
 * deployed behind.
 *
 * The byte ceiling is not ours: `createMcpExpressApp` mounts `express.json()`
 * with no limit, so express's 100 KiB default applies, and an SDK upgrade
 * could move it without anything here mentioning it. That is what this file
 * is for. It asserts the relationship rather than either number, so it fails
 * if the cap rises past what the transport will carry OR if the transport
 * tightens beneath the cap.
 *
 * It speaks real HTTP to a real server for the same reason the transport
 * tests do: the limit lives in middleware, and a mock of the middleware would
 * be testing the mock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startHttpServer } from "../src/http.js";
import { MAX_ANALYSIS_IDENTIFIERS } from "../src/config.js";
import { estimateAnalysisBodyBytes } from "../src/tools/limits.js";

/** Longer than a gene symbol or a UniProt accession; an Ensembl gene ID is 15. */
const PESSIMISTIC_IDENTIFIER = "X".repeat(20);

function post(base: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${base}/mcp`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      res => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

const analyzeCall = (count: number, identifier = PESSIMISTIC_IDENTIFIER) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "reactome_analyze_identifiers",
      arguments: { identifiers: Array.from({ length: count }, () => identifier) },
    },
  });

describe("request body ceiling", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = await startHttpServer(0, "127.0.0.1");
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => server.close());

  it("carries a request at the identifier cap", async () => {
    // 400 here is the session check refusing an uninitialised call — which
    // means the body was read and parsed. The assertion is only that it was
    // not refused for its size.
    const status = await post(base, analyzeCall(MAX_ANALYSIS_IDENTIFIERS));
    expect(status).not.toBe(413);
    expect(status).toBe(400);
  });

  it("refuses a body far above it", async () => {
    // Without this the test above would pass against a server with no limit
    // at all, and would stop being about anything.
    const status = await post(base, analyzeCall(MAX_ANALYSIS_IDENTIFIERS * 10));
    expect(status).toBe(413);
  });

  it("leaves headroom rather than sitting on the boundary", async () => {
    // A cap that only just fits is one identifier-length change away from
    // being unreachable again. 20-character identifiers at the cap should use
    // well under the ceiling.
    const bytes = Buffer.byteLength(analyzeCall(MAX_ANALYSIS_IDENTIFIERS));
    expect(bytes).toBeLessThan(90_000);
  });
});

describe("the startup estimate", () => {
  /**
   * `startHttpServer` warns when the *configured* cap cannot fit through the
   * transport, using an estimate rather than a serialised request. An
   * estimate that under-states the real body would make that warning worse
   * than none: it would stay silent on exactly the misconfiguration it
   * exists to report.
   */
  it("never under-states a real request at the cap", () => {
    const real = Buffer.byteLength(analyzeCall(MAX_ANALYSIS_IDENTIFIERS));
    expect(estimateAnalysisBodyBytes(MAX_ANALYSIS_IDENTIFIERS)).toBeGreaterThanOrEqual(real);
  });

  it("would fire on the cap that was actually wrong", () => {
    // 10,000 was shipped in the previous commit and could not be delivered.
    // If the estimate does not flag that, it flags nothing worth flagging.
    expect(estimateAnalysisBodyBytes(10_000)).toBeGreaterThan(102_400);
  });

  it("does not fire on the cap in use", () => {
    expect(estimateAnalysisBodyBytes(MAX_ANALYSIS_IDENTIFIERS)).toBeLessThan(102_400);
  });
});
