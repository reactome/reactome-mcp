import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { registerAllTools } from "../src/tools/index.js";
import { registerStaticResources } from "../src/resources/static.js";
import { buildServerInstructions } from "../src/instructions.js";

/**
 * This server does not reach Neo4j, and cannot be configured to.
 *
 * It is hosted publicly. Constitution Principle IV always said no deployment
 * holds a graph connection, and until 2026-09-21 that was enforced by a gate
 * — which meant the property was true of a *configuration* rather than of the
 * code. Gates get flipped, and this one was tested in four places and got
 * three of them: `src/http-server.ts`, the entrypoint that actually runs in
 * production, still opened a connection on `NEO4J_URI` alone.
 *
 * So the tools are gone instead. These tests set the environment that used to
 * switch graph access ON, because asserting absence with the switch OFF would
 * only confirm the old gate still works.
 */

const GRAPH_ENV = { NEO4J_URI: "bolt://localhost:7690", MCP_ALLOW_CYPHER: "1" };

function withGraphEnv<T>(body: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(GRAPH_ENV)) {
    previous[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return body();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function collect(register: (server: never) => void, key: "tool" | "resource"): string[] {
  const names: string[] = [];
  const server = {
    [key]: (...args: unknown[]) => {
      if (typeof args[0] === "string") names.push(args[0]);
      return undefined;
    },
  };
  register(server as never);
  return names;
}

describe("no graph access", () => {
  it("registers no Cypher tool even with the old switches on", () => {
    const names = withGraphEnv(() => collect(registerAllTools, "tool"));
    expect(names.filter(n => n.includes("cypher"))).toEqual([]);
    // The sweep is only meaningful if the other tools did register.
    expect(names.length).toBeGreaterThan(50);
  });

  it("publishes no graph schema resource", () => {
    const names = withGraphEnv(() => collect(registerStaticResources, "resource"));
    expect(names).not.toContain("reactome://graph/schema");
    expect(names).toContain("reactome://species");
  });

  it("does not tell clients a graph is available", () => {
    // The instructions were the surface that survived the gate: a server
    // advertising tools it had not registered is invisible to any check that
    // asks the server what it can do, because it says it can.
    const text = withGraphEnv(buildServerInstructions);
    expect(text.toLowerCase()).not.toContain("cypher");
    expect(text.toLowerCase()).not.toContain("neo4j");
    expect(text).toContain("reactome_search");
  });

  it("has no neo4j driver dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter(d => d.includes("neo4j"))).toEqual([]);
  });

  it("has no source file that imports a graph driver", () => {
    // The tools could come back one import at a time. This is the check that
    // notices before a tool exists to catch.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts")) {
          const text = readFileSync(full, "utf8");
          if (/from\s+["']neo4j-driver["']/.test(text)) offenders.push(full);
        }
      }
    };
    walk(new URL("../src", import.meta.url).pathname);
    expect(offenders).toEqual([]);
  });
});
