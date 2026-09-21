import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Who can run arbitrary graph queries.
 *
 * Until 2026-09-21 the Cypher tools registered whenever `NEO4J_URI` was set,
 * so "can the public run Cypher" was a side effect of a connection string. A
 * public instance that set it for the graph-schema warm-up, or for a future
 * non-Cypher graph tool, would have published `reactome_cypher_query` by
 * doing so — and nothing would have looked wrong.
 *
 * These drive `registerAllTools` with a recording stub and assert on which
 * tool names reach it, because that is the only place the answer is visible.
 */

const TOOL_NAMES = () => {
  const names: string[] = [];
  const server = {
    tool: (...args: unknown[]) => {
      if (typeof args[0] === "string") names.push(args[0]);
      return undefined;
    },
  };
  return { server, names };
};

async function registerWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const { registerAllTools } = await import("../src/tools/index.js");
    const { server, names } = TOOL_NAMES();
    registerAllTools(server as never);
    return names;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const isCypher = (name: string) => name.startsWith("reactome_cypher");

describe("Cypher tool exposure", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.resetModules());

  it("registers no Cypher tools with neither variable set", async () => {
    const names = await registerWith({
      NEO4J_URI: undefined,
      MCP_ALLOW_CYPHER: undefined,
    });
    expect(names.filter(isCypher)).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });

  it("registers no Cypher tools when NEO4J_URI alone is set", async () => {
    // The case that mattered: a connection string is not consent. This is
    // the configuration a public instance would most plausibly arrive at.
    const names = await registerWith({
      NEO4J_URI: "bolt://localhost:7690",
      MCP_ALLOW_CYPHER: undefined,
    });
    expect(names.filter(isCypher)).toEqual([]);
  });

  it("registers no Cypher tools when the opt-in is set without a connection", async () => {
    const names = await registerWith({
      NEO4J_URI: undefined,
      MCP_ALLOW_CYPHER: "1",
    });
    expect(names.filter(isCypher)).toEqual([]);
  });

  it("registers them only when both are set", async () => {
    // Without this the three above would pass against a build that never
    // registers Cypher at all, and prove nothing.
    const names = await registerWith({
      NEO4J_URI: "bolt://localhost:7690",
      MCP_ALLOW_CYPHER: "1",
    });
    expect(names.filter(isCypher).length).toBeGreaterThan(0);
  });

  it("treats any value other than 1 as not opted in", async () => {
    for (const value of ["", "0", "true", "yes", "TRUE"]) {
      const names = await registerWith({
        NEO4J_URI: "bolt://localhost:7690",
        MCP_ALLOW_CYPHER: value,
      });
      expect(names.filter(isCypher), `MCP_ALLOW_CYPHER=${value}`).toEqual([]);
    }
  });
});
