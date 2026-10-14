import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { AddressInfo } from "node:net";
import type { FakeNeo4jState } from "./helpers/fake-neo4j.js";

/**
 * Graph database access is off unless an operator turns it on, twice.
 *
 * The Cypher tools exist for internal instances pointed at a dedicated
 * Reactome graph database. A publicly hosted instance must never offer them:
 * an arbitrary query from the internet can take the database -- and the
 * website in front of it -- down.
 *
 * The gate is `NEO4J_URI` set AND `MCP_ALLOW_CYPHER=1`. These tests do not
 * check the predicate once and trust the call sites: they drive **every**
 * surface, through every entrypoint and factory, in every combination of the
 * two variables, and count both loads of `neo4j-driver` and driver
 * constructions on a fake that cannot open a socket. Each surface is asserted
 * in both directions: "absent when closed" alone would pass against a build
 * that never offers graph access at all. A new entrypoint belongs here.
 */

const fake = vi.hoisted((): FakeNeo4jState => ({ drivers: [], sessions: [], respond: () => [] }));

/**
 * Registered per test, after `vi.resetModules()`, rather than once with
 * `vi.mock`: a hoisted mock's factory runs once per file, so it could not
 * count whether a given entrypoint loaded `neo4j-driver` at all. Re-registered
 * like this, the factory runs on the first import after each reset, and
 * `fake.moduleLoads` says whether anything imported it.
 */
function mockDriverModule() {
  vi.doMock("neo4j-driver", async () => {
    const { fakeNeo4jModule } = await import("./helpers/fake-neo4j.js");
    return fakeNeo4jModule(fake);
  });
}

// The stdio entrypoint connects a transport on import. This one talks to
// nothing, so importing `src/index.ts` runs the real startup path -- server
// construction, and the schema warm-up -- without touching stdin/stdout.
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    onclose?: () => void;
    onerror?: (e: Error) => void;
    onmessage?: (m: unknown) => void;
    async start() {}
    async close() {}
    async send() {}
  },
}));

const URI = "bolt://127.0.0.1:7687";
const GRAPH_VARS = ["NEO4J_URI", "MCP_ALLOW_CYPHER", "MCP_TOOL_GROUPS", "MCP_HTTP_PORT"] as const;

interface GateCase {
  name: string;
  env: Partial<Record<(typeof GRAPH_VARS)[number], string>>;
  open: boolean;
}

const CASES: GateCase[] = [
  { name: "neither variable set", env: {}, open: false },
  // The case that matters most: a connection string is not consent. This is
  // the configuration a public instance would most plausibly arrive at.
  { name: "NEO4J_URI alone", env: { NEO4J_URI: URI }, open: false },
  { name: "MCP_ALLOW_CYPHER=1 alone", env: { MCP_ALLOW_CYPHER: "1" }, open: false },
  {
    name: "NEO4J_URI with MCP_ALLOW_CYPHER=true (only 1 counts)",
    env: { NEO4J_URI: URI, MCP_ALLOW_CYPHER: "true" },
    open: false,
  },
  {
    name: "a blank NEO4J_URI with MCP_ALLOW_CYPHER=1",
    env: { NEO4J_URI: "  ", MCP_ALLOW_CYPHER: "1" },
    open: false,
  },
  { name: "both set", env: { NEO4J_URI: URI, MCP_ALLOW_CYPHER: "1" }, open: true },
];

const CYPHER_TOOLS = ["reactome_cypher_query", "reactome_cypher_schema", "reactome_cypher_sample"];
const SCHEMA_URI = "reactome://graph/schema";

let saved: Record<string, string | undefined> = {};

function applyEnv(env: GateCase["env"]) {
  saved = {};
  for (const key of GRAPH_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
}

function restoreEnv() {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function resetFake() {
  fake.drivers.length = 0;
  fake.sessions.length = 0;
  fake.respond = () => [];
  fake.moduleLoads = 0;
}

/** Let fire-and-forget startup work (the schema warm-up) run to completion. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 5));
}

const cypherNames = (names: string[]) => names.filter(n => n.startsWith("reactome_cypher"));

function recordingServer() {
  const tools: string[] = [];
  const resources: string[] = [];
  const server = {
    tool: (...args: unknown[]) => {
      if (typeof args[0] === "string") tools.push(args[0]);
      return undefined;
    },
    resource: (...args: unknown[]) => {
      const t = args[1] as { uriTemplate?: { toString(): string } } | undefined;
      const uri = typeof args[1] === "string" ? args[1] : t?.uriTemplate?.toString();
      if (uri) resources.push(uri);
      return undefined;
    },
  };
  return { server: server as never, tools, resources };
}

describe.each(CASES)("graph access gate: $name", ({ env, open }) => {
  beforeEach(() => {
    applyEnv(env);
    resetFake();
    vi.resetModules();
    mockDriverModule();
  });

  afterEach(() => {
    restoreEnv();
    vi.doUnmock("../src/http.js");
    vi.resetModules();
  });

  it(`the shared predicate reports ${open ? "open" : "closed"}`, async () => {
    const { isGraphAccessEnabled } = await import("../src/graph/gate.js");
    expect(isGraphAccessEnabled()).toBe(open);
  });

  it(`createServer ${open ? "offers" : "withholds"} the tools, the resource and the instructions, and constructs no driver`, async () => {
    const { createServer } = await import("../src/server.js");
    const server = createServer() as unknown as {
      _registeredTools: Record<string, unknown>;
      _registeredResources: Record<string, unknown>;
      server: { _instructions?: string };
    };

    const tools = Object.keys(server._registeredTools);
    const resources = Object.keys(server._registeredResources);
    const instructions = server.server._instructions ?? "";

    // The REST surface is there either way; the server is usable.
    expect(tools).toContain("reactome_search");
    expect(instructions).toContain("reactome_search");

    if (open) {
      expect(cypherNames(tools).sort()).toEqual([...CYPHER_TOOLS].sort());
      expect(resources).toContain(SCHEMA_URI);
      expect(instructions).toContain("reactome_cypher_query");
    } else {
      expect(cypherNames(tools)).toEqual([]);
      expect(resources).not.toContain(SCHEMA_URI);
      expect(instructions.toLowerCase()).not.toContain("cypher");
      expect(instructions.toLowerCase()).not.toContain("neo4j");
    }

    // Building a server is not a reason to connect: the driver is lazy.
    expect(fake.drivers).toHaveLength(0);
  });

  it(`registrars given every group explicitly still ${open ? "offer" : "withhold"} graph access`, async () => {
    // Defence in depth: a caller that bypasses resolveToolGroups() and hands
    // the registrars the full group list must not get past the gate either.
    const { registerAllTools, TOOL_GROUPS } = await import("../src/tools/index.js");
    const { registerAllResources } = await import("../src/resources/index.js");
    const { buildServerInstructions } = await import("../src/instructions.js");
    const everyGroup = Object.keys(TOOL_GROUPS) as Parameters<typeof registerAllTools>[1];

    const rec = recordingServer();
    registerAllTools(rec.server, everyGroup);
    registerAllResources(rec.server, everyGroup);
    const text = buildServerInstructions(everyGroup);

    if (open) {
      expect(cypherNames(rec.tools)).toHaveLength(3);
      expect(rec.resources).toContain(SCHEMA_URI);
      expect(text).toContain("reactome_cypher_schema");
    } else {
      expect(cypherNames(rec.tools)).toEqual([]);
      expect(rec.resources).not.toContain(SCHEMA_URI);
      expect(text.toLowerCase()).not.toContain("cypher");
    }
    expect(fake.drivers).toHaveLength(0);
  });

  it(`MCP_TOOL_GROUPS naming cypher ${open ? "is honoured" : "refuses to start"}`, async () => {
    const { resolveToolGroups } = await import("../src/tools/index.js");
    if (open) {
      expect(resolveToolGroups("search,cypher")).toEqual(["search", "cypher"]);
    } else {
      // Asking for graph access and not getting it is loud, not silent.
      expect(() => resolveToolGroups("search,cypher")).toThrow(/MCP_ALLOW_CYPHER/);
    }
  });

  it(`the driver factory ${open ? "constructs a driver" : "refuses to construct one"}`, async () => {
    const { getDriver, runRead } = await import("../src/clients/neo4j.js");
    if (open) {
      expect(await getDriver()).toBeDefined();
      expect(fake.drivers).toHaveLength(1);
    } else {
      await expect(getDriver()).rejects.toThrow(/MCP_ALLOW_CYPHER/);
      await expect(runRead("RETURN 1")).rejects.toThrow(/MCP_ALLOW_CYPHER/);
      expect(fake.drivers).toHaveLength(0);
      // Refused before the library is even loaded.
      expect(fake.moduleLoads).toBe(0);
    }
  });

  it(`the stdio entrypoint ${open ? "warms the schema over one driver" : "never constructs a driver"}`, async () => {
    await import("../src/index.js");
    await settle();
    expect(fake.drivers).toHaveLength(open ? 1 : 0);
    // A closed instance never loads neo4j-driver at all.
    expect(fake.moduleLoads).toBe(open ? 1 : 0);
    if (open) {
      // The warm-up ran, read-only, on the dedicated graph.
      expect(fake.drivers[0]?.uri).toBe(URI);
      expect(fake.sessions.length).toBeGreaterThan(0);
      for (const s of fake.sessions) expect(s.config.defaultAccessMode).toBe("READ");
    }
  });

  it(`the HTTP entrypoint ${open ? "warms the schema over one driver" : "never constructs a driver"}`, async () => {
    // src/http-server.ts is the entrypoint a hosted instance runs. Its
    // transport is stubbed so nothing binds; everything it does after the
    // server starts is real.
    vi.doMock("../src/http.js", () => ({ startHttpServer: vi.fn(async () => ({})) }));
    process.env.MCP_HTTP_PORT = "4999";
    await import("../src/http-server.js");
    await settle();
    expect(fake.drivers).toHaveLength(open ? 1 : 0);
    expect(fake.moduleLoads).toBe(open ? 1 : 0);
  });

  it(`startHttpServer sessions ${open ? "offer" : "withhold"} graph access, and construct no driver`, async () => {
    const { startHttpServer } = await import("../src/http.js");
    const http = await startHttpServer(0, "127.0.0.1");
    try {
      const { port } = http.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };

      const init = await fetch(`${base}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "vitest", version: "0" },
          },
        }),
      });
      const initText = await init.text();
      const sessionId = init.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      const session = { ...headers, "mcp-session-id": sessionId ?? "" };

      await fetch(`${base}/mcp`, {
        method: "POST",
        headers: session,
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });

      const list = async (method: string) => {
        const res = await fetch(`${base}/mcp`, {
          method: "POST",
          headers: session,
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method }),
        });
        return res.text();
      };
      const toolsText = await list("tools/list");
      const resourcesText = await list("resources/list");
      const health = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>;

      expect(toolsText).toContain("reactome_search");
      if (open) {
        for (const name of CYPHER_TOOLS) expect(toolsText).toContain(`"${name}"`);
        expect(resourcesText).toContain(SCHEMA_URI);
        expect(initText).toContain("reactome_cypher_query");
      } else {
        expect(toolsText).not.toContain("reactome_cypher");
        expect(resourcesText).not.toContain(SCHEMA_URI);
        expect(initText.toLowerCase()).not.toContain("cypher");
      }
      // An operator can see which way the gate went without reading the env.
      expect(health.graphAccess).toBe(open);
      // Serving sessions is not a reason to connect, or to load the driver.
      expect(fake.drivers).toHaveLength(0);
      expect(fake.moduleLoads).toBe(0);
    } finally {
      await new Promise(resolve => http.close(resolve));
    }
  });
});

describe("graph access gate: open, but the cypher group withheld", () => {
  beforeEach(() => {
    applyEnv({ NEO4J_URI: URI, MCP_ALLOW_CYPHER: "1", MCP_TOOL_GROUPS: "search,pathway" });
    resetFake();
    vi.resetModules();
    mockDriverModule();
  });

  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("offers nothing graph-shaped and opens no connection for nobody", async () => {
    const { createServer } = await import("../src/server.js");
    const server = createServer() as unknown as {
      _registeredTools: Record<string, unknown>;
      _registeredResources: Record<string, unknown>;
    };
    expect(cypherNames(Object.keys(server._registeredTools))).toEqual([]);
    expect(Object.keys(server._registeredResources)).not.toContain(SCHEMA_URI);

    // Without the tools or the resource nothing can read a warmed cache, so
    // the warm-up must not connect.
    await import("../src/index.js");
    await settle();
    expect(fake.drivers).toHaveLength(0);
  });
});

describe("graph access gate: structure", () => {
  it("imports neo4j-driver from exactly one file, the gated factory", () => {
    // Every connection has to go through getDriver(), which checks the gate
    // itself. A second import would be a second door.
    const importers: string[] = [];
    const root = new URL("../src", import.meta.url).pathname;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts")) {
          const text = readFileSync(full, "utf8");
          if (/(from\s+|import\s*\(\s*)["']neo4j-driver["']/.test(text)) {
            importers.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(importers).toEqual(["clients/neo4j.ts"]);
  });

  it("keeps neo4j-driver as a declared dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies["neo4j-driver"]).toBeDefined();
  });
});

describe("graph access gate: /health reports the gate as it is now", () => {
  beforeEach(() => {
    applyEnv({});
    resetFake();
    vi.resetModules();
    mockDriverModule();
  });

  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("follows the environment per request, as sessions do", async () => {
    // Sessions are built per request and ask the gate each time, so a value
    // captured at startup could disagree with what a new session is offered.
    const { startHttpServer } = await import("../src/http.js");
    const http = await startHttpServer(0, "127.0.0.1");
    try {
      const { port } = http.address() as AddressInfo;
      const health = async () =>
        ((await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as Record<string, unknown>)
          .graphAccess;

      expect(await health()).toBe(false);
      process.env.NEO4J_URI = URI;
      process.env.MCP_ALLOW_CYPHER = "1";
      expect(await health()).toBe(true);
      delete process.env.MCP_ALLOW_CYPHER;
      expect(await health()).toBe(false);
    } finally {
      await new Promise(resolve => http.close(resolve));
    }
  });
});
