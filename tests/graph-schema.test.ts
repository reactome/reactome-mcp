import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FakeNeo4jState } from "./helpers/fake-neo4j.js";
import type { GraphSchema } from "../src/graph/schema.js";

/**
 * Schema extraction against the database the tools are actually pointed at:
 * the Reactome graph database container, which runs Neo4j 4.4 Community with
 * **no APOC**. The previous version read `apoc.meta.*` and would have failed
 * there on its first query. These script a fake driver that answers like that
 * database -- APOC procedures do not exist -- and assert the schema is built
 * from built-in procedures, with each optional section degrading on its own.
 */

const fake = vi.hoisted((): FakeNeo4jState => ({ drivers: [], sessions: [], respond: () => [] }));

vi.mock("neo4j-driver", async () => {
  const { fakeNeo4jModule } = await import("./helpers/fake-neo4j.js");
  return fakeNeo4jModule(fake);
});

import { queriesRun } from "./helpers/fake-neo4j.js";
import { community44, NO_PROCEDURE } from "./helpers/community44.js";
import {
  fetchGraphSchema,
  _resetGraphSchemaCache,
  SCHEMA_RETRY_AFTER_MS,
} from "../src/graph/schema.js";
import { SCHEMA_FORMAT } from "../src/graph/schema-source.js";
import { formatGraphSchemaMarkdown } from "../src/graph/format-schema.js";
import { closeDriver } from "../src/clients/neo4j.js";

describe("fetchGraphSchema on Neo4j 4.4 Community without APOC", () => {
  beforeEach(() => {
    process.env.NEO4J_URI = "bolt://127.0.0.1:7687";
    process.env.MCP_ALLOW_CYPHER = "1";
    fake.drivers.length = 0;
    fake.sessions.length = 0;
    fake.respond = community44();
    _resetGraphSchemaCache();
  });

  afterEach(async () => {
    _resetGraphSchemaCache();
    await closeDriver();
    delete process.env.NEO4J_URI;
    delete process.env.MCP_ALLOW_CYPHER;
  });

  it("builds every section from built-in procedures and never calls APOC", async () => {
    const schema = await fetchGraphSchema();

    expect(queriesRun(fake).filter(q => /apoc\./i.test(q))).toEqual([]);
    expect(schema.unavailable).toEqual([]);
    expect(schema.dbComponents[0]?.edition).toBe("community");
    expect(schema.stats.nodeCount).toBe(3_000_000);
    expect(schema.stats.relCount).toBe(12_000_000);
    expect(schema.stats.labels).toEqual({ Pathway: 2_000, Reaction: 500 });
    expect(schema.stats.relTypesCount).toEqual({ hasEvent: 9_000, input: 500 });
    expect(schema.patterns).toEqual([{ start: "Pathway", type: "hasEvent", end: "Reaction" }]);
    expect(schema.nodeTypeProperties[0]?.propertyName).toBe("stId");
    // The built-in reports ":`input`"; the schema carries the bare name.
    expect(schema.relTypeProperties[0]?.relType).toBe("input");
    expect(schema.indexes[0]?.name).toBe("index_pathway_stId");
    expect(schema.constraints[0]?.name).toBe("constraint_dbId");
  });

  it("records which database it describes, and the format it is written in", async () => {
    // A schema saved to a file is only usable against the database it came
    // from; the fingerprint is how a reader tells.
    const schema = await fetchGraphSchema();
    expect(schema.schemaFormat).toBe(SCHEMA_FORMAT);
    const digest = expect.stringMatching(/^[0-9a-f]{64}$/);
    expect(schema.source).toEqual({
      neo4jVersion: "4.4.40",
      neo4jEdition: "community",
      database: "neo4j",
      releaseNumber: 97,
      nodeCount: 3_000_000,
      relCount: 12_000_000,
      labelsDigest: digest,
      relationshipTypesDigest: digest,
      propertyKeysDigest: digest,
      indexesDigest: digest,
      constraintsDigest: digest,
      generatedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(schema.source?.generatedAt ?? ""))).toBe(false);
  });

  it("is format 2: format 1 files carried no metadata digests", () => {
    expect(SCHEMA_FORMAT).toBe(2);
  });

  it("digests each metadata list in a canonical order, so the order the database answers in does not matter", async () => {
    const first = (await fetchGraphSchema()).source;
    _resetGraphSchemaCache();
    fake.respond = community44({
      "db.labels": () => [{ label: "Reaction" }, { label: "Pathway" }],
      "db.propertyKeys": () => [
        { propertyKey: "stoichiometry" },
        { propertyKey: "dbId" },
        { propertyKey: "stId" },
      ],
    });
    const second = (await fetchGraphSchema()).source;
    expect(second?.labelsDigest).toBe(first?.labelsDigest);
    expect(second?.propertyKeysDigest).toBe(first?.propertyKeysDigest);
  });

  it("leaves the release out, rather than guessing, where there is no DBInfo node", async () => {
    // A curator database or a non-Reactome graph has none. That is not a
    // failure: the rest of the fingerprint still identifies the database.
    fake.respond = community44({ DBInfo: () => [] });
    const schema = await fetchGraphSchema();
    expect(schema.unavailable).toEqual([]);
    expect(schema.source).not.toHaveProperty("releaseNumber");
    expect(schema.source?.nodeCount).toBe(3_000_000);
  });

  it("reads only, and under a timeout", async () => {
    await fetchGraphSchema();
    expect(fake.sessions.length).toBeGreaterThan(0);
    for (const session of fake.sessions) {
      expect(session.config.defaultAccessMode).toBe("READ");
      for (const run of session.runs) expect(run.config?.timeout).toBeGreaterThan(0);
    }
  });

  it("falls back to db.indexes() and db.constraints() where SHOW is not understood", async () => {
    const unsupported = () => {
      throw new Error("Invalid input 'SHOW'");
    };
    fake.respond = community44({
      "SHOW INDEXES": unsupported,
      "SHOW CONSTRAINTS": unsupported,
      "db.indexes": () => [
        {
          name: "legacy_index",
          type: "BTREE",
          entityType: "NODE",
          labelsOrTypes: ["Pathway"],
          properties: ["stId"],
          state: "ONLINE",
        },
      ],
      "db.constraints": () => [
        { name: "legacy_constraint", description: "CONSTRAINT ON (d:DatabaseObject) ..." },
      ],
    });

    const schema = await fetchGraphSchema();
    expect(schema.indexes.map(i => i.name)).toEqual(["legacy_index"]);
    expect(schema.constraints.map(c => c.name)).toEqual(["legacy_constraint"]);
    expect(schema.unavailable).toEqual([]);
  });

  it("reports a section that fails everywhere, and still returns the rest", async () => {
    fake.respond = community44({
      "db.schema.nodeTypeProperties": () => {
        throw new Error("The transaction has been terminated (timeout)");
      },
      "db.indexes": () => {
        throw NO_PROCEDURE("db.indexes");
      },
      "SHOW INDEXES": () => {
        throw new Error("Invalid input 'SHOW'");
      },
    });

    const schema = await fetchGraphSchema();
    expect(schema.nodeTypeProperties).toEqual([]);
    expect(schema.indexes).toEqual([]);
    // The fingerprint digests the index list, so without one there is no
    // fingerprint either -- and no saved schema could be verified against it.
    expect(schema.unavailable.map(u => u.section).sort()).toEqual(
      ["indexes", "nodeTypeProperties", "source"].sort()
    );
    // The rest is intact.
    expect(schema.stats.labels.Pathway).toBe(2_000);

    // And the digest says so, rather than rendering an empty section as if
    // the graph had no properties.
    const md = formatGraphSchemaMarkdown(schema);
    expect(md).toContain("Unavailable");
    expect(md).toContain("nodeTypeProperties");
  });

  it("retries a failed section on a later fetch rather than caching the failure for good", async () => {
    // A section that timed out during the startup warm-up used to stay
    // "unavailable" for the life of the process.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let failing = true;
      fake.respond = community44({
        "db.schema.nodeTypeProperties": () => {
          if (failing) throw new Error("The transaction has been terminated (timeout)");
          return [
            {
              nodeType: ":`Pathway`",
              nodeLabels: ["Pathway"],
              propertyName: "stId",
              propertyTypes: ["String"],
              mandatory: true,
            },
          ];
        },
      });

      const first = await fetchGraphSchema();
      expect(first.unavailable.map(u => u.section)).toEqual(["nodeTypeProperties"]);

      // Straight away: served from cache, not retried on every call.
      const before = queriesRun(fake).length;
      await fetchGraphSchema();
      expect(queriesRun(fake).length).toBe(before);

      // Later: only the failed section is read again, and it now succeeds.
      failing = false;
      vi.setSystemTime(Date.now() + SCHEMA_RETRY_AFTER_MS + 1);
      const later = await fetchGraphSchema();
      expect(later.unavailable).toEqual([]);
      expect(later.nodeTypeProperties).toHaveLength(1);
      expect(later.stats.labels.Pathway).toBe(2_000);
      const rerun = queriesRun(fake).slice(before);
      expect(rerun.length).toBeGreaterThan(0);
      expect(rerun.every(q => q.includes("db.schema.nodeTypeProperties"))).toBe(true);

      // Complete now, so cached for good.
      vi.setSystemTime(Date.now() + SCHEMA_RETRY_AFTER_MS * 10);
      const settledCount = queriesRun(fake).length;
      expect(await fetchGraphSchema()).toBe(later);
      expect(queriesRun(fake).length).toBe(settledCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses rather than caching an empty schema when nothing answers", async () => {
    fake.respond = () => {
      throw new Error("Could not perform discovery. No routing servers available.");
    };
    await expect(fetchGraphSchema()).rejects.toThrow(/schema/i);

    // Not cached: the next call tries again.
    fake.respond = community44();
    const schema = await fetchGraphSchema();
    expect(schema.stats.labels.Pathway).toBe(2_000);
  });

  it("caches; a second call runs no queries", async () => {
    const first = await fetchGraphSchema();
    const before = queriesRun(fake).length;
    const second = await fetchGraphSchema();
    expect(second).toBe(first);
    expect(queriesRun(fake).length).toBe(before);
  });

  it("shares one fetch between concurrent first callers", async () => {
    const [a, b, c] = await Promise.all([
      fetchGraphSchema(),
      fetchGraphSchema(),
      fetchGraphSchema(),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    // A query one fetch runs exactly once. (dbms.components runs twice per
    // fetch: once for the source fingerprint, once for dbComponents.)
    expect(queriesRun(fake).filter(q => q.includes("db.schema.visualization"))).toHaveLength(1);
  });
});

function minimalSchema(): GraphSchema {
  return {
    schemaFormat: SCHEMA_FORMAT,
    fetchedAt: "2026-10-14T15:00:00Z",
    source: {
      neo4jVersion: "4.4.40",
      neo4jEdition: "community",
      database: "neo4j",
      releaseNumber: 97,
      nodeCount: 100,
      relCount: 200,
      labelsDigest: "0".repeat(64),
      relationshipTypesDigest: "0".repeat(64),
      propertyKeysDigest: "0".repeat(64),
      indexesDigest: "0".repeat(64),
      constraintsDigest: "0".repeat(64),
      generatedAt: "2026-10-14T15:00:00Z",
    },
    dbComponents: [{ name: "Neo4j Kernel", versions: ["4.4.40"], edition: "community" }],
    stats: {
      nodeCount: 100,
      relCount: 200,
      labels: { Pathway: 50, Reaction: 30, Entity: 20 },
      relTypesCount: { hasEvent: 80, input: 120 },
    },
    patterns: [{ start: "Pathway", type: "hasEvent", end: "Reaction" }],
    nodeTypeProperties: [
      {
        nodeType: ":`Pathway`",
        nodeLabels: ["Pathway"],
        propertyName: "stId",
        propertyTypes: ["String"],
        mandatory: true,
      },
      {
        nodeType: ":`Pathway`",
        nodeLabels: ["Pathway"],
        propertyName: "displayName",
        propertyTypes: ["String"],
        mandatory: false,
      },
    ],
    relTypeProperties: [
      { relType: "input", propertyName: "stoichiometry", propertyTypes: ["Long"], mandatory: true },
    ],
    indexes: [
      {
        name: "pathway_stId",
        labelsOrTypes: ["Pathway"],
        properties: ["stId"],
        type: "BTREE",
        state: "ONLINE",
      },
    ],
    constraints: [
      { name: "pathway_stId_unique", labelsOrTypes: ["Pathway"], properties: ["stId"] },
    ],
    unavailable: [],
  };
}

describe("formatGraphSchemaMarkdown", () => {
  it("covers totals, labels, rel types, patterns, properties, indexes, constraints", () => {
    const md = formatGraphSchemaMarkdown(minimalSchema());
    expect(md).toContain("Neo4j:** 4.4.40");
    expect(md).toContain("**Reactome release:** 97");
    expect(md).toContain("100 nodes");
    expect(md).toContain("`Pathway` 50");
    expect(md).toContain("`hasEvent` 80");
    expect(md).toContain("(:Pathway)-[:hasEvent]->(:Reaction)");
    expect(md).toContain("stId String!");
    expect(md).toContain("stoichiometry Long! — on input");
    expect(md).toContain("### Indexes (1)");
    expect(md).toContain("### Constraints (1)");
    expect(md).toContain("reactome://graph/schema");
    expect(md).not.toContain("Unavailable");
    // Nothing in the digest should send a reader looking for APOC.
    expect(md.toLowerCase()).not.toContain("apoc");
  });

  it("names no release for a graph that has none", () => {
    const { releaseNumber: _omitted, ...source } = minimalSchema().source!;
    const md = formatGraphSchemaMarkdown({ ...minimalSchema(), source });
    expect(md).not.toContain("Reactome release");
  });

  it("stays small enough for an LLM context window", () => {
    expect(formatGraphSchemaMarkdown(minimalSchema()).length).toBeLessThan(10_000);
  });

  it("summarises a type's endpoints as label sets, most specific first", () => {
    // Reactome nodes carry their class hierarchy as labels, so the real
    // visualization lists hundreds of pairs per type. Listing them pair by
    // pair took the digest past the response cap.
    const md = formatGraphSchemaMarkdown({
      ...minimalSchema(),
      patterns: [
        { start: "Pathway", type: "hasEvent", end: "Reaction" },
        { start: "Pathway", type: "hasEvent", end: "Entity" },
        { start: "Reaction", type: "hasEvent", end: "Reaction" },
      ],
    });
    expect(md).toContain("(:Reaction|Pathway)-[:hasEvent]->(:Entity|Reaction)");
  });

  it("lists properties every label set shares once", () => {
    const md = formatGraphSchemaMarkdown({
      ...minimalSchema(),
      nodeTypeProperties: [
        {
          nodeType: ":`A`",
          nodeLabels: ["A"],
          propertyName: "dbId",
          propertyTypes: ["Long"],
          mandatory: true,
        },
        {
          nodeType: ":`A`",
          nodeLabels: ["A"],
          propertyName: "a",
          propertyTypes: ["String"],
          mandatory: false,
        },
        {
          nodeType: ":`B`",
          nodeLabels: ["B"],
          propertyName: "dbId",
          propertyTypes: ["Long"],
          mandatory: true,
        },
      ],
    });
    expect(md).toContain("**On every label set:** dbId Long!");
    expect(md).toContain("- **A**: a String");
    expect(md).toContain("- **B**\n");
  });

  it("omits empty index and constraint sections", () => {
    const md = formatGraphSchemaMarkdown({ ...minimalSchema(), indexes: [], constraints: [] });
    expect(md).not.toContain("### Indexes");
    expect(md).not.toContain("### Constraints");
  });

  it("orders labels by count, descending", () => {
    const md = formatGraphSchemaMarkdown(minimalSchema());
    const p = md.indexOf("`Pathway` 50");
    const r = md.indexOf("`Reaction` 30");
    const e = md.indexOf("`Entity` 20");
    expect(p).toBeLessThan(r);
    expect(r).toBeLessThan(e);
  });
});
