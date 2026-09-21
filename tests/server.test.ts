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

  it("registers no graph tools, whatever the environment says", () => {
    // Principle IV, now structural rather than configured: there are no graph
    // tools to gate. The environment is set to what used to switch them ON,
    // because a test that unsets it would be asserting the old gate still
    // works rather than that the tools are gone.
    process.env.NEO4J_URI = "bolt://localhost:7690";
    process.env.MCP_ALLOW_CYPHER = "1";
    try {
      const server = createServer();
      const registered = server as unknown as { _registeredTools?: Record<string, unknown> };
      const toolNames = Object.keys(registered._registeredTools ?? {});

      expect(toolNames.filter(n => n.includes("cypher"))).toEqual([]);
      expect(toolNames.length).toBeGreaterThan(40);
    } finally {
      delete process.env.NEO4J_URI;
      delete process.env.MCP_ALLOW_CYPHER;
    }
  });
});
