import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { registerAllTools } from "../src/tools/index.js";

/**
 * The README says it lists every tool. It should be true.
 *
 * This list is about to be the public description of a publicly hosted
 * server, so "which tools exist" stops being a documentation detail. When
 * this was first written the README said "over 40 tools" and omitted the GSA
 * section entirely — five tools that were registered, served, and documented
 * nowhere.
 *
 * A prose count goes stale the first time someone adds a tool. A test does
 * not.
 */
describe("README tool coverage", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  const registered = (): string[] => {
    const names: string[] = [];
    registerAllTools({
      tool: (...args: unknown[]) => {
        if (typeof args[0] === "string") names.push(args[0]);
        return undefined;
      },
    } as never);
    return names;
  };

  it("documents every registered tool", () => {
    const missing = registered().filter(name => !readme.includes(name));
    expect(missing).toEqual([]);
  });

  it("documents the graph tools, which only register behind the gate", () => {
    process.env.NEO4J_URI = "bolt://127.0.0.1:7687";
    process.env.MCP_ALLOW_CYPHER = "1";
    try {
      const names = registered();
      expect(names.filter(n => n.startsWith("reactome_cypher"))).toHaveLength(3);
      expect(names.filter(name => !readme.includes(name))).toEqual([]);
      expect(readme).toContain(`${names.length} with graph access`);
    } finally {
      delete process.env.NEO4J_URI;
      delete process.env.MCP_ALLOW_CYPHER;
    }
    expect(readme).toContain("MCP_ALLOW_CYPHER");
  });

  it("states the tool count, and states it correctly", () => {
    const names = registered();
    expect(names.length).toBeGreaterThan(0);
    expect(readme).toContain(`${names.length} tools`);
  });
});
