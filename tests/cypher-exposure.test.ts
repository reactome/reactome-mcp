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

/**
 * The tools were the obvious surface. Two others answer the same question and
 * were left behind by the first version of this guard: the server's own
 * instructions, which tell a client Cypher is available and name the tools to
 * call, and the `reactome://graph/schema` resource, which runs
 * apoc.meta.schema() for the caller and returns the internal graph model.
 *
 * Each of these is asserted in both directions. The absent case alone would
 * pass against a build that never offers the thing at all.
 */

async function withEnv<T>(
  env: Record<string, string | undefined>,
  body: () => Promise<T>
): Promise<T> {
  vi.resetModules();
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const CONNECTED_ONLY = { NEO4J_URI: "bolt://localhost:7690", MCP_ALLOW_CYPHER: undefined };
const OPTED_IN = { NEO4J_URI: "bolt://localhost:7690", MCP_ALLOW_CYPHER: "1" };

async function instructions(env: Record<string, string | undefined>) {
  return withEnv(env, async () => {
    const { buildServerInstructions } = await import("../src/instructions.js");
    return buildServerInstructions();
  });
}

describe("server instructions", () => {
  it("does not advertise Cypher on a connection alone", async () => {
    const text = await instructions(CONNECTED_ONLY);
    expect(text).not.toContain("reactome_cypher_query");
    expect(text).not.toContain("Graph database (Cypher)");
    // Still a usable server: the core instructions are there.
    expect(text).toContain("reactome_search");
  });

  it("advertises Cypher once opted in", async () => {
    const text = await instructions(OPTED_IN);
    expect(text).toContain("reactome_cypher_query");
  });
});

async function resourceNames(env: Record<string, string | undefined>) {
  return withEnv(env, async () => {
    const { registerStaticResources } = await import("../src/resources/static.js");
    const names: string[] = [];
    const server = {
      resource: (...args: unknown[]) => {
        if (typeof args[0] === "string") names.push(args[0]);
        return undefined;
      },
    };
    registerStaticResources(server as never);
    return names;
  });
}

describe("graph schema resource", () => {
  it("is not registered on a connection alone", async () => {
    const names = await resourceNames(CONNECTED_ONLY);
    expect(names).not.toContain("reactome://graph/schema");
    expect(names).toContain("reactome://species");
  });

  it("is registered once opted in", async () => {
    const names = await resourceNames(OPTED_IN);
    expect(names).toContain("reactome://graph/schema");
  });
});
