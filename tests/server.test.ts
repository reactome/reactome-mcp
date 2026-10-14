/**
 * The server factory exists so construction can be exercised without a
 * transport. These tests use the real registration path -- not the fake server
 * the formatter tests use -- so a tool that fails to register is caught here.
 *
 * Adapted from the server-registration tests in #5 by @adidev001.
 */
import { describe, it, expect } from "vitest";
import { createServer, SERVER_NAME, SERVER_VERSION } from "../src/server.js";

describe("createServer", () => {
  it("builds a server without connecting a transport", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it("can be called more than once, returning independent servers", () => {
    // A hosted deployment builds one per session; module-scope construction
    // could not do this.
    const a = createServer();
    const b = createServer();
    expect(a).not.toBe(b);
  });

  it("names itself consistently", () => {
    expect(SERVER_NAME).toBe("reactome");
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("registers tools and resources", () => {
    const server = createServer();
    // Reach through to the underlying Server's registered handlers: the
    // McpServer wrapper does not expose a public inventory.
    const registered = server as unknown as {
      _registeredTools?: Record<string, unknown>;
      _registeredResources?: Record<string, unknown>;
    };
    const toolNames = Object.keys(registered._registeredTools ?? {});

    expect(toolNames.length).toBeGreaterThan(40);
    expect(toolNames).toContain("reactome_search");
    expect(toolNames).toContain("reactome_get_pathway");
    expect(toolNames).toContain("reactome_analyze_identifiers");
  });

  it("offers graph tools only behind both switches", () => {
    // The full matrix, every entrypoint, lives in graph-access-gate.test.ts.
    // This is the factory's own check, in both directions: absent on a
    // connection string alone, present once the opt-in is added too.
    const cypherTools = () => {
      const server = createServer() as unknown as { _registeredTools?: Record<string, unknown> };
      return Object.keys(server._registeredTools ?? {}).filter(n =>
        n.startsWith("reactome_cypher")
      );
    };
    process.env.NEO4J_URI = "bolt://127.0.0.1:7687";
    try {
      expect(cypherTools()).toEqual([]);
      process.env.MCP_ALLOW_CYPHER = "1";
      expect(cypherTools()).toHaveLength(3);
    } finally {
      delete process.env.NEO4J_URI;
      delete process.env.MCP_ALLOW_CYPHER;
    }
  });
});
