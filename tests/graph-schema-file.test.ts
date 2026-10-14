import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeNeo4jState } from "./helpers/fake-neo4j.js";
import type { GraphSchema } from "../src/graph/schema.js";

/**
 * `NEO4J_SCHEMA_FILE`: serve a schema extracted earlier instead of paying for
 * the full extraction at startup -- but only for the database it describes.
 *
 * The server reads the file, takes the cheap part of the live fingerprint
 * (version, release, total counts), and serves the file only if every field
 * agrees. Anything else -- another release, a database that has changed, an
 * older file format, a file that is not JSON, or is not there -- is warned
 * about by name and the schema is extracted live, as if no file were set. A
 * schema for a different database is never served: it would be read as a
 * description of this one.
 */

const fake = vi.hoisted((): FakeNeo4jState => ({ drivers: [], sessions: [], respond: () => [] }));

vi.mock("neo4j-driver", async () => {
  const { fakeNeo4jModule } = await import("./helpers/fake-neo4j.js");
  return fakeNeo4jModule(fake);
});

import { queriesRun } from "./helpers/fake-neo4j.js";
import { community44 } from "./helpers/community44.js";
import { fetchGraphSchema, _resetGraphSchemaCache } from "../src/graph/schema.js";
import { SCHEMA_FORMAT } from "../src/graph/schema-source.js";
import { closeDriver } from "../src/clients/neo4j.js";
import { logger } from "../src/logger.js";

/**
 * What only the full extraction runs. None of it may run when the file is
 * used. (Token lists, indexes and constraints are part of the fingerprint:
 * metadata reads, not scans.)
 */
const EXPENSIVE = [
  "db.schema.nodeTypeProperties",
  "db.schema.relTypeProperties",
  "db.schema.visualization",
  "UNION ALL",
];
const expensiveRun = () => queriesRun(fake).filter(q => EXPENSIVE.some(e => q.includes(e)));

let dir: string;
let snapshot: GraphSchema;
let warn: MockInstance<typeof logger.warn>;
let info: MockInstance<typeof logger.info>;

/** A snapshot of the scripted database, taken by the extractor itself. */
async function takeSnapshot(): Promise<GraphSchema> {
  const schema = await fetchGraphSchema();
  _resetGraphSchemaCache();
  fake.sessions.length = 0;
  return structuredClone(schema);
}

function writeSnapshot(content: unknown): string {
  const file = join(dir, "schema.json");
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  process.env.NEO4J_SCHEMA_FILE = file;
  return file;
}

const warnings = () => warn.mock.calls.map(c => JSON.stringify(c));

describe("NEO4J_SCHEMA_FILE", () => {
  beforeEach(async () => {
    process.env.NEO4J_URI = "bolt://127.0.0.1:7687";
    process.env.MCP_ALLOW_CYPHER = "1";
    delete process.env.NEO4J_SCHEMA_FILE;
    fake.drivers.length = 0;
    fake.sessions.length = 0;
    fake.respond = community44();
    _resetGraphSchemaCache();
    dir = mkdtempSync(join(tmpdir(), "schema-file-"));
    snapshot = await takeSnapshot();
    warn = vi.spyOn(logger, "warn");
    info = vi.spyOn(logger, "info");
  });

  afterEach(async () => {
    warn.mockRestore();
    info.mockRestore();
    _resetGraphSchemaCache();
    await closeDriver();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.NEO4J_URI;
    delete process.env.MCP_ALLOW_CYPHER;
    delete process.env.NEO4J_SCHEMA_FILE;
  });

  it("serves a matching file without running the full extraction", async () => {
    writeSnapshot(snapshot);

    const schema = await fetchGraphSchema();

    expect(schema).toEqual(snapshot);
    expect(expensiveRun()).toEqual([]);
    // It did check: the cheap fingerprint queries ran, read-only.
    const run = queriesRun(fake);
    expect(run.some(q => q.includes("dbms.components"))).toBe(true);
    expect(run.some(q => q.includes("DBInfo"))).toBe(true);
    for (const s of fake.sessions) expect(s.config.defaultAccessMode).toBe("READ");
    expect(warnings()).toEqual([]);
    // And says so: which file, for which release, on which database.
    const served = info.mock.calls.find(([msg]) => /served from file/.test(msg));
    expect(served?.[1]).toMatchObject({
      file: expect.stringContaining("schema.json"),
      releaseNumber: 97,
      database: "neo4j",
    });

    // Complete, so cached: a second call runs nothing at all.
    const before = queriesRun(fake).length;
    expect(await fetchGraphSchema()).toBe(schema);
    expect(queriesRun(fake).length).toBe(before);
  });

  it("serves a file without a release against a database without a DBInfo node", async () => {
    fake.respond = community44({ DBInfo: () => [] });
    const curator = await takeSnapshot();
    expect(curator.source).not.toHaveProperty("releaseNumber");
    writeSnapshot(curator);

    expect(await fetchGraphSchema()).toEqual(curator);
    expect(expensiveRun()).toEqual([]);
  });

  type Case = {
    name: string;
    /** Applied to the file, the database, or both. */
    file?: (s: GraphSchema) => unknown;
    db?: Parameters<typeof community44>[0];
    reason: RegExp;
  };

  const CASES: Case[] = [
    {
      name: "a different Reactome release",
      db: { DBInfo: () => [{ releaseNumber: 98 }] },
      reason: /releaseNumber/,
    },
    {
      name: "a release in the file where the database has no DBInfo node",
      db: { DBInfo: () => [] },
      reason: /releaseNumber/,
    },
    {
      name: "a different node count (the database has changed since)",
      db: { "MATCH (n) RETURN count(n)": () => [{ count: 3_000_001 }] },
      reason: /nodeCount/,
    },
    {
      name: "a different relationship count",
      db: { "MATCH ()-[r]->() RETURN count(r)": () => [{ count: 1 }] },
      reason: /relCount/,
    },
    {
      name: "a different Neo4j version",
      db: {
        "dbms.components": () => [
          { name: "Neo4j Kernel", versions: ["5.26.0"], edition: "community" },
        ],
      },
      reason: /neo4jVersion/,
    },
    // Changes a curator makes that leave both totals as they were.
    {
      name: "a new property key (SET n.newProp on an existing node)",
      db: {
        "db.propertyKeys": () => [
          { propertyKey: "stId" },
          { propertyKey: "dbId" },
          { propertyKey: "stoichiometry" },
          { propertyKey: "newProp" },
        ],
      },
      reason: /propertyKeys/,
    },
    {
      name: "a new label",
      db: { "db.labels": () => [{ label: "Pathway" }, { label: "Reaction" }, { label: "New" }] },
      reason: /labels/,
    },
    {
      name: "a new relationship type",
      db: {
        "db.relationshipTypes": () => [
          { relationshipType: "hasEvent" },
          { relationshipType: "input" },
          { relationshipType: "output" },
        ],
      },
      reason: /relationshipTypes/,
    },
    {
      name: "a new index (CREATE INDEX)",
      db: {
        "SHOW INDEXES": () => [
          {
            name: "index_pathway_stId",
            type: "BTREE",
            entityType: "NODE",
            labelsOrTypes: ["Pathway"],
            properties: ["stId"],
            state: "ONLINE",
          },
          {
            name: "index_new",
            type: "BTREE",
            entityType: "NODE",
            labelsOrTypes: ["Reaction"],
            properties: ["stId"],
            state: "ONLINE",
          },
        ],
      },
      reason: /indexes/,
    },
    {
      name: "an index that is no longer online",
      db: {
        "SHOW INDEXES": () => [
          {
            name: "index_pathway_stId",
            type: "BTREE",
            entityType: "NODE",
            labelsOrTypes: ["Pathway"],
            properties: ["stId"],
            state: "POPULATING",
          },
        ],
      },
      reason: /indexes/,
    },
    {
      name: "a dropped constraint",
      db: { "SHOW CONSTRAINTS": () => [] },
      reason: /constraints/,
    },
    {
      name: "another database on the same server",
      db: { "db.info": () => [{ name: "curation" }] },
      reason: /database/,
    },
    {
      name: "a format 1 file, which carried no metadata digests",
      file: s => ({ ...s, schemaFormat: 1 }),
      reason: /schemaFormat/,
    },
    // Files that disagree with themselves.
    {
      name: "stats.nodeCount that disagrees with the fingerprint",
      file: s => ({ ...s, stats: { ...s.stats, nodeCount: s.stats.nodeCount + 1 } }),
      reason: /nodeCount/,
    },
    {
      name: "stats.relCount that disagrees with the fingerprint",
      file: s => ({ ...s, stats: { ...s.stats, relCount: 0 } }),
      reason: /relCount/,
    },
    {
      name: "a label list that disagrees with the fingerprint",
      file: s => ({ ...s, stats: { ...s.stats, labels: { ...s.stats.labels, Extra: 1 } } }),
      reason: /labels/,
    },
    {
      name: "a relationship type list that disagrees with the fingerprint",
      file: s => ({ ...s, stats: { ...s.stats, relTypesCount: { hasEvent: 9_000 } } }),
      reason: /relationshipTypes/,
    },
    {
      name: "an index list that disagrees with the fingerprint",
      file: s => ({ ...s, indexes: [] }),
      reason: /indexes/,
    },
    {
      name: "a constraint list that disagrees with the fingerprint",
      file: s => ({ ...s, constraints: [] }),
      reason: /constraints/,
    },
    {
      name: "a Neo4j version that disagrees with the fingerprint",
      file: s => ({
        ...s,
        dbComponents: [{ name: "Neo4j Kernel", versions: ["5.0.0"], edition: "community" }],
      }),
      reason: /neo4jVersion/,
    },
    {
      name: "another schema format",
      file: s => ({ ...s, schemaFormat: SCHEMA_FORMAT + 1 }),
      reason: /schemaFormat/,
    },
    {
      name: "no schema format at all (a file from before there was one)",
      file: ({ schemaFormat: _f, ...rest }) => rest,
      reason: /schemaFormat/,
    },
    {
      name: "no source fingerprint",
      file: s => ({ ...s, source: null }),
      reason: /source/,
    },
    {
      name: "a file that is not JSON",
      file: () => '{"schemaFormat": 1, "stats": ',
      reason: /JSON/,
    },
    {
      name: "JSON that is not a schema",
      file: s => ({ schemaFormat: s.schemaFormat, source: s.source }),
      reason: /patterns|stats|nodeTypeProperties/,
    },
    {
      name: "a snapshot with unavailable sections",
      file: s => ({ ...s, unavailable: [{ section: "indexes", reason: "timeout" }] }),
      reason: /unavailable/,
    },
  ];

  it.each(CASES)("falls back to live extraction, with a warning, on $name", async c => {
    writeSnapshot(c.file ? c.file(snapshot) : snapshot);
    if (c.db) fake.respond = community44(c.db);

    const schema = await fetchGraphSchema();

    // Extracted live: the expensive procedures ran, and what is served
    // describes the database that answered, not the file.
    expect(expensiveRun().length).toBeGreaterThan(0);
    expect(schema.unavailable).toEqual([]);
    expect(schema.fetchedAt).not.toBe(snapshot.fetchedAt);

    const said = warnings().join("\n");
    expect(said).toContain("schema.json");
    expect(said).toMatch(c.reason);
  });

  it("falls back, with a warning, when the file is not there", async () => {
    process.env.NEO4J_SCHEMA_FILE = join(dir, "missing.json");
    const schema = await fetchGraphSchema();
    expect(expensiveRun().length).toBeGreaterThan(0);
    expect(schema.unavailable).toEqual([]);
    expect(warnings().join("\n")).toContain("missing.json");
  });

  it("never serves the file when the database cannot be fingerprinted", async () => {
    // Unverifiable is not a match. With the database down, the live
    // extraction fails too, and that is what the caller hears.
    writeSnapshot(snapshot);
    fake.respond = () => {
      throw new Error("Could not perform discovery. No routing servers available.");
    };
    await expect(fetchGraphSchema()).rejects.toThrow(/schema/i);
    expect(warnings().join("\n")).toContain("schema.json");
  });
});
