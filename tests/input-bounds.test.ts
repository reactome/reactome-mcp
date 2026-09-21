import { describe, it, expect, vi } from "vitest";
import { registerAllTools } from "../src/tools/index.js";
import { MAX_ANALYSIS_IDENTIFIERS } from "../src/config.js";

/**
 * How much a caller may send *in*.
 *
 * `installToolWrapper` caps what a call returns, and argues for doing it in
 * one place because "a per-tool guard is a guard somebody forgets to add to
 * the fifty-seventh". The same was never true of inputs:
 * `reactome_analyze_identifiers` accepted an unbounded array and posted it to
 * the Analysis Service, so a few bytes of MCP request could commission an
 * arbitrarily large job. Private, that is academic; behind a public nginx it
 * is an amplification with no ceiling in the path.
 *
 * An input ceiling cannot live in the wrapper — only the individual argument
 * knows what a sane length is. So the *requirement* lives here instead: this
 * walks every registered tool and fails on any argument that will accept an
 * absurd array. A new tool with an unbounded list fails this without anyone
 * remembering it exists.
 *
 * It probes by parsing rather than by reading zod internals, so it keeps
 * working across zod versions and cannot pass by misreading a private field.
 *
 * What it does not reach: an array nested inside an object argument. No tool
 * has one today, and a sweep that silently covered less than it claims would
 * be worse than this one, so the limit is stated rather than implied.
 */

type Shape = Record<string, { safeParse: (v: unknown) => { success: boolean } }>;

function registeredSchemas(): Map<string, Shape> {
  const schemas = new Map<string, Shape>();
  const server = {
    tool: (...args: unknown[]) => {
      const name = args[0];
      const shape = args[2];
      if (typeof name === "string" && shape && typeof shape === "object") {
        schemas.set(name, shape as Shape);
      }
      return undefined;
    },
  };
  registerAllTools(server as never);
  return schemas;
}

/**
 * Every tool in *every* configuration, not just the default one.
 *
 * The first version of the sweep called `registerAllTools` once, with no
 * environment, and so walked 59 of the 62 tools -- the three Cypher tools
 * register only behind `NEO4J_URI` plus `MCP_ALLOW_CYPHER`. A sweep whose
 * entire value is completeness, quietly covering a subset, is the exact
 * failure it was written to prevent. It is also the same shape as the Cypher
 * gate itself: the thing that varies by configuration, checked in one
 * configuration.
 */
async function allSchemas(): Promise<Map<string, Shape>> {
  const merged = new Map<string, Shape>();
  const configs = [{}, { NEO4J_URI: "bolt://localhost:7690", MCP_ALLOW_CYPHER: "1" }];
  for (const env of configs) {
    vi.resetModules();
    const previous: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      previous[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const mod = await import("../src/tools/index.js");
      const server = {
        tool: (...args: unknown[]) => {
          const name = args[0];
          const shape = args[2];
          if (typeof name === "string" && shape && typeof shape === "object") {
            merged.set(name, shape as Shape);
          }
          return undefined;
        },
      };
      mod.registerAllTools(server as never);
    } finally {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      vi.resetModules();
    }
  }
  return merged;
}

const ABSURD = Array.from({ length: 100_001 }, () => "R-HSA-109582");
const ONE = ["R-HSA-109582"];

describe("tool input bounds", () => {
  it("covers every tool, and the set does not change with the environment", async () => {
    const schemas = await allSchemas();
    // Without this the sweep would pass vacuously against an empty map. The
    // exact count is asserted rather than a floor, so a tool that appears
    // only under some environment shows up here as a number that moved.
    expect(schemas.size).toBe(59);
    expect([...schemas.keys()].filter(n => n.includes("cypher"))).toEqual([]);
  });

  it("has no argument anywhere that accepts an unbounded list", async () => {
    const schemas = await allSchemas();
    const unbounded: string[] = [];
    let arrayArgs = 0;
    for (const [tool, shape] of schemas) {
      for (const [arg, schema] of Object.entries(shape)) {
        if (typeof schema?.safeParse !== "function") continue;
        // Identify list arguments by behaviour: it takes a one-element array.
        if (!schema.safeParse(ONE).success) continue;
        arrayArgs++;
        if (schema.safeParse(ABSURD).success) unbounded.push(`${tool}.${arg}`);
      }
    }
    // The sweep is only meaningful if it found the list arguments at all.
    expect(arrayArgs).toBeGreaterThan(0);
    expect(unbounded).toEqual([]);
  });
});

describe("analysis identifier list", () => {
  const identifiers = () => {
    const shape = registeredSchemas().get("reactome_analyze_identifiers");
    if (!shape) throw new Error("reactome_analyze_identifiers is not registered");
    const arg = shape.identifiers;
    if (!arg) throw new Error("reactome_analyze_identifiers has no identifiers argument");
    return arg;
  };

  it("accepts a list at the cap", () => {
    const atCap = Array.from({ length: MAX_ANALYSIS_IDENTIFIERS }, () => "TP53");
    expect(identifiers().safeParse(atCap).success).toBe(true);
  });

  it("rejects one identifier past the cap", () => {
    const overCap = Array.from({ length: MAX_ANALYSIS_IDENTIFIERS + 1 }, () => "TP53");
    expect(identifiers().safeParse(overCap).success).toBe(false);
  });

  it("rejects an empty list", () => {
    // Previously posted an empty body to the Analysis Service.
    expect(identifiers().safeParse([]).success).toBe(false);
  });

  it("still rejects a blank identifier", () => {
    // The bound must not have replaced the emptiness check on each element.
    expect(identifiers().safeParse(["TP53", ""]).success).toBe(false);
  });
});

describe("optional filter lists", () => {
  // Capping these should not have changed what a working client may send.
  // `.min(1)` here would have bounded nothing and only added a way to fail.
  const filter = (tool: string, arg: string) => {
    const shape = registeredSchemas().get(tool);
    if (!shape) throw new Error(`${tool} is not registered`);
    const schema = shape[arg];
    if (!schema) throw new Error(`${tool} has no ${arg} argument`);
    return schema;
  };

  it("still accepts an empty list, as before the cap", () => {
    expect(filter("reactome_search", "types").safeParse([]).success).toBe(true);
    expect(filter("reactome_export_diagram", "sel").safeParse([]).success).toBe(true);
  });

  it("still accepts a normal list", () => {
    expect(filter("reactome_search", "types").safeParse(["Pathway"]).success).toBe(true);
  });

  it("rejects an absurd one", () => {
    expect(filter("reactome_search", "types").safeParse(ABSURD).success).toBe(false);
  });
});
