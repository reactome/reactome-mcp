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

  it("states the tool count, and states it correctly", () => {
    const names = registered();
    expect(names.length).toBeGreaterThan(0);
    expect(readme).toContain(`${names.length} tools`);
  });
});
