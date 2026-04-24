import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GraphSchema } from "../src/graph/schema.js";
import { formatGraphSchemaMarkdown } from "../src/graph/format-schema.js";

function minimalSchema(): GraphSchema {
  return {
    fetchedAt: "2026-04-24T15:00:00Z",
    dbComponents: [{ name: "Neo4j Kernel", versions: ["4.3.6"], edition: "enterprise" }],
    stats: {
      nodeCount: 100,
      relCount: 200,
      labels: { Pathway: 50, Reaction: 30, Entity: 20 },
      relTypes: { "(:Pathway)-[:hasEvent]->(:Reaction)": 80 },
      relTypesCount: { hasEvent: 80, inputOf: 120 },
    },
    schema: { Pathway: { type: "node" } },
    nodeTypeProperties: [
      { nodeType: ":`Pathway`", nodeLabels: ["Pathway"], propertyName: "stId", propertyTypes: ["String"], mandatory: true },
      { nodeType: ":`Pathway`", nodeLabels: ["Pathway"], propertyName: "displayName", propertyTypes: ["String"], mandatory: false },
    ],
    relTypeProperties: [
      { relType: "hasEvent", sourceNodeLabels: ["Pathway"], targetNodeLabels: ["Reaction"], propertyName: "stoichiometry", propertyTypes: ["Long"], mandatory: false },
    ],
    indexes: [{ name: "pathway_stId", labelsOrTypes: ["Pathway"], properties: ["stId"], type: "BTREE", state: "ONLINE" }],
    constraints: [{ name: "pathway_stId_unique", description: "CONSTRAINT ON ( pathway:Pathway ) ASSERT (pathway.stId) IS UNIQUE" }],
  };
}

describe("formatGraphSchemaMarkdown", () => {
  it("covers totals, labels, rel types, properties, indexes, constraints", () => {
    const md = formatGraphSchemaMarkdown(minimalSchema());
    expect(md).toContain("Neo4j:** 4.3.6");
    expect(md).toContain("100 nodes");
    expect(md).toContain("`Pathway` — 50");
    expect(md).toContain("`hasEvent` — 80");
    expect(md).toContain("`stId` _(String)_ **required**");
    expect(md).toContain("### Indexes (1)");
    expect(md).toContain("### Constraints (1)");
    expect(md).toContain("reactome://graph/schema");
  });

  it("stays small enough for an LLM context window", () => {
    expect(formatGraphSchemaMarkdown(minimalSchema()).length).toBeLessThan(10_000);
  });

  it("handles missing indexes/constraints gracefully", () => {
    const empty = { ...minimalSchema(), indexes: [], constraints: [] };
    const md = formatGraphSchemaMarkdown(empty);
    expect(md).not.toContain("### Indexes");
    expect(md).not.toContain("### Constraints");
  });

  it("orders labels and rel types by count, descending", () => {
    const md = formatGraphSchemaMarkdown(minimalSchema());
    const pathwayIdx = md.indexOf("`Pathway` — 50");
    const reactionIdx = md.indexOf("`Reaction` — 30");
    const entityIdx = md.indexOf("`Entity` — 20");
    expect(pathwayIdx).toBeLessThan(reactionIdx);
    expect(reactionIdx).toBeLessThan(entityIdx);
  });
});

// Mock runRead from the neo4j client module so fetchGraphSchema (which
// imports from that module) sees the mock.
vi.mock("../src/clients/neo4j.js", () => ({
  runRead: vi.fn(),
}));

import { runRead } from "../src/clients/neo4j.js";
import { fetchGraphSchema, _resetGraphSchemaCache } from "../src/graph/schema.js";

function setupRunReadResponses() {
  (runRead as ReturnType<typeof vi.fn>).mockImplementation(async (cypher: string) => {
    if (cypher.includes("dbms.components"))
      return [{ name: "Neo4j Kernel", versions: ["4.3.6"], edition: "enterprise" }];
    if (cypher.includes("apoc.meta.stats"))
      return [{ nodeCount: 10, relCount: 5, labels: { X: 10 }, relTypes: {}, relTypesCount: {} }];
    if (cypher.includes("apoc.meta.schema")) return [{ value: {} }];
    return [];
  });
}

describe("fetchGraphSchema caching", () => {
  beforeEach(() => {
    _resetGraphSchemaCache();
    (runRead as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    _resetGraphSchemaCache();
  });

  it("caches the result; second call is a no-op on the driver", async () => {
    setupRunReadResponses();
    const first = await fetchGraphSchema();
    const callsAfterFirst = (runRead as ReturnType<typeof vi.fn>).mock.calls.length;
    const second = await fetchGraphSchema();
    const callsAfterSecond = (runRead as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(first).toBe(second);
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it("dedupes concurrent in-flight calls to a single fetch", async () => {
    let resolveStats: (v: unknown) => void = () => {};
    const statsPromise = new Promise((r) => { resolveStats = r; });

    (runRead as ReturnType<typeof vi.fn>).mockImplementation(async (cypher: string) => {
      if (cypher.includes("dbms.components"))
        return [{ name: "Neo4j Kernel", versions: ["4.3.6"], edition: "enterprise" }];
      if (cypher.includes("apoc.meta.stats")) {
        await statsPromise;
        return [{ nodeCount: 1, relCount: 1, labels: {}, relTypes: {}, relTypesCount: {} }];
      }
      if (cypher.includes("apoc.meta.schema")) return [{ value: {} }];
      return [];
    });

    const p1 = fetchGraphSchema();
    const p2 = fetchGraphSchema();
    const p3 = fetchGraphSchema();

    resolveStats(undefined);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);

    const statsCalls = (runRead as ReturnType<typeof vi.fn>).mock.calls
      .filter(([q]) => String(q).includes("apoc.meta.stats")).length;
    expect(statsCalls).toBe(1);
  });

  it("recovers when optional calls fail (relTypeProperties / indexes / constraints)", async () => {
    (runRead as ReturnType<typeof vi.fn>).mockImplementation(async (cypher: string) => {
      if (cypher.includes("dbms.components"))
        return [{ name: "Neo4j Kernel", versions: ["4.3.6"], edition: "enterprise" }];
      if (cypher.includes("apoc.meta.stats"))
        return [{ nodeCount: 1, relCount: 1, labels: {}, relTypes: {}, relTypesCount: {} }];
      if (cypher.includes("apoc.meta.schema")) return [{ value: {} }];
      if (cypher.includes("apoc.meta.nodeTypeProperties")) return [];
      // Simulate older Neo4j where these procs don't exist or return differently
      if (cypher.includes("apoc.meta.relTypeProperties")) throw new Error("no such proc");
      if (cypher.includes("db.indexes")) throw new Error("no such proc");
      if (cypher.includes("db.constraints")) throw new Error("no such proc");
      return [];
    });

    const schema = await fetchGraphSchema();
    expect(schema.relTypeProperties).toEqual([]);
    expect(schema.indexes).toEqual([]);
    expect(schema.constraints).toEqual([]);
  });
});
