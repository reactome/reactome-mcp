/**
 * Response size is a correctness concern for an MCP server, not a cosmetic
 * one: every character a tool returns is spent from the caller's context
 * window. Before these limits, one `reactome_events_hierarchy` call rendered
 * ~86 KB (~22,000 tokens) and `reactome_query` on Metabolism ~60 KB, because
 * the size is driven by the ID asked about rather than by anything the tool
 * decides.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { capToolText, capToolResult } from "../src/response-limits.js";
import { MAX_TOOL_RESPONSE_CHARS } from "../src/config.js";
import { createFakeServer, textOf, calledUrl } from "./helpers/fake-server.js";
import { registerPathwayTools } from "../src/tools/pathway.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("capToolText", () => {
  it("leaves text under the limit exactly as it was", () => {
    const text = "a".repeat(100);
    expect(capToolText(text, "some_tool", 1000)).toBe(text);
  });

  it("leaves text at exactly the limit alone", () => {
    const text = "a".repeat(1000);
    expect(capToolText(text, "some_tool", 1000)).toBe(text);
  });

  it("announces the cut rather than making it silently", () => {
    const capped = capToolText("a".repeat(5000), "reactome_query", 1000);

    // A model that cannot see it was truncated reports the partial answer as
    // the whole one.
    expect(capped).toContain("Truncated");
    expect(capped).toContain("reactome_query");
    expect(capped).toContain("5,000");
    expect(capped.length).toBeLessThanOrEqual(1000);
  });

  it("names how much was dropped and what to do instead", () => {
    const capped = capToolText("x".repeat(3000), "reactome_events_hierarchy", 1000);
    expect(capped).toContain("Narrow the request");
  });

  it("prefers to cut at a line boundary", () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i} of some content here`).join("\n");
    const capped = capToolText(text, "t", 900);
    const body = capped.split("\n\n---\n")[0] ?? "";
    // The visible body should not end mid-line.
    expect(text.split("\n")).toContain(body.split("\n").at(-1));
  });
});

describe("capToolResult", () => {
  it("passes a small result through untouched", () => {
    const result = { content: [{ type: "text", text: "small" }] };
    expect(capToolResult(result, "t")).toBe(result);
  });

  it("caps a result over the limit", () => {
    const result = {
      content: [{ type: "text", text: "a".repeat(MAX_TOOL_RESPONSE_CHARS + 5000) }],
    };
    const capped = capToolResult(result, "t") as { content: Array<{ text: string }> };

    expect(capped.content[0]!.text.length).toBeLessThanOrEqual(MAX_TOOL_RESPONSE_CHARS);
    expect(capped.content[0]!.text).toContain("Truncated");
  });

  it("budgets across blocks, since two large blocks cost the same as one", () => {
    const half = MAX_TOOL_RESPONSE_CHARS;
    const result = {
      content: [
        { type: "text", text: "a".repeat(half) },
        { type: "text", text: "b".repeat(half) },
      ],
    };
    const capped = capToolResult(result, "t") as { content: Array<{ text: string }> };
    const total = capped.content.reduce((n, b) => n + b.text.length, 0);

    expect(total).toBeLessThanOrEqual(MAX_TOOL_RESPONSE_CHARS);
  });

  it("leaves a result with no text content alone", () => {
    const result = { content: [{ type: "image", data: "..." }] };
    expect(capToolResult(result, "t")).toBe(result);
  });

  it("does not throw on a malformed result", () => {
    expect(() => capToolResult(null, "t")).not.toThrow();
    expect(() => capToolResult({ nope: true }, "t")).not.toThrow();
  });
});

describe("events hierarchy depth", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  const fake = createFakeServer();
  registerPathwayTools(fake.server);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  /** A tree deep enough that rendering all of it would be the old behaviour. */
  function deepTree(depth: number, breadth = 2): unknown {
    const node = (level: number, path: string): unknown => ({
      stId: `R-HSA-${path}`,
      name: `Level ${level} node ${path}`,
      type: "Pathway",
      children:
        level >= depth
          ? undefined
          : Array.from({ length: breadth }, (_, i) => node(level + 1, `${path}${i}`)),
    });
    return [node(0, "0")];
  }

  it("stops at the requested depth instead of walking the whole tree", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(deepTree(8)));

    const text = textOf(await fake.invoke("reactome_events_hierarchy", { max_depth: 2 }));

    expect(text).toContain("Level 0");
    expect(text).toContain("Level 2");
    expect(text).not.toContain("Level 4");
    // And says why it stopped, pointing at the tool that goes deeper.
    expect(text).toContain("reactome_pathway_contained_events");
  });

  it("renders a deeper tree when asked", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(deepTree(8)));

    const text = textOf(await fake.invoke("reactome_events_hierarchy", { max_depth: 5 }));
    expect(text).toContain("Level 5");
    expect(text).not.toContain("Level 7");
  });

  it("defaults to the taxonomy ID, which is the form that endpoint answers", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(deepTree(1)));

    await fake.invoke("reactome_events_hierarchy", {});
    // "Homo sapiens" is answered with HTTP 500 by this endpoint; "9606" is not.
    expect(calledUrl(fetchSpy.mock.calls)).toContain("9606");
  });
});

describe("argument validation", () => {
  const fake = createFakeServer();
  registerPathwayTools(fake.server);

  // These assertions were impossible until the fake server started running the
  // zod schema: it called handlers with raw params, so validation never ran.

  it("rejects a blank id rather than requesting /data/query/enhanced/", () => {
    expect(() => fake.invoke("reactome_get_pathway", { id: "   " })).toThrow();
  });

  it("rejects an empty id", () => {
    expect(() => fake.invoke("reactome_get_pathway", { id: "" })).toThrow();
  });

  it("trims a padded id instead of sending the padding", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        dbId: 1,
        stId: "R-HSA-109582",
        displayName: "Hemostasis",
        schemaClass: "Pathway",
      })
    );
    try {
      await fake.invoke("reactome_get_pathway", { id: "  R-HSA-109582  " });
      const url = calledUrl(fetchSpy.mock.calls);
      expect(url).toContain("R-HSA-109582");
      expect(url).not.toContain("%20");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects a max_depth outside the allowed range", () => {
    expect(() => fake.invoke("reactome_events_hierarchy", { max_depth: 99 })).toThrow();
    expect(() => fake.invoke("reactome_events_hierarchy", { max_depth: 0 })).toThrow();
  });
});
