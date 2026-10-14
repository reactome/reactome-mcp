import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeNeo4jState } from "./helpers/fake-neo4j.js";

/**
 * `reactome-mcp extract-schema`: the server's own extractor, run once against
 * a database named on the command line, written out as JSON.
 *
 * It is an operator tool run by hand, not an instance: it serves nothing, so
 * it does not ask for MCP_ALLOW_CYPHER. It still reads only, under the same
 * timeouts as the server, and it never takes a password as an argument --
 * anything on a command line is visible to every user of the machine in `ps`.
 */

const fake = vi.hoisted((): FakeNeo4jState => ({ drivers: [], sessions: [], respond: () => [] }));

vi.mock("neo4j-driver", async () => {
  const { fakeNeo4jModule } = await import("./helpers/fake-neo4j.js");
  return fakeNeo4jModule(fake);
});

import { queriesRun } from "./helpers/fake-neo4j.js";
import { community44 } from "./helpers/community44.js";
import { runExtractSchema } from "../src/cli/extract-schema.js";
import { fetchGraphSchema, _resetGraphSchemaCache } from "../src/graph/schema.js";
import { SCHEMA_FORMAT } from "../src/graph/schema-source.js";
import { closeDriver } from "../src/clients/neo4j.js";

const URI = "bolt://127.0.0.1:7687";
const ENV_KEYS = [
  "NEO4J_URI",
  "MCP_ALLOW_CYPHER",
  "NEO4J_USER",
  "NEO4J_PASSWORD",
  "NEO4J_DATABASE",
  "NEO4J_SCHEMA_FILE",
  "SNAPSHOT_PW",
];

let saved: Record<string, string | undefined>;
let dir: string;
let out: string[];
let err: string[];

const io = () => ({ stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) });
const run = (...args: string[]) => runExtractSchema(args, io());

/** Timestamps differ between two extractions of the same database. */
function untimed(schema: Record<string, unknown>) {
  const source = schema.source as Record<string, unknown>;
  return { ...schema, fetchedAt: "T", source: { ...source, generatedAt: "T" } };
}

describe("reactome-mcp extract-schema", () => {
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    fake.drivers.length = 0;
    fake.sessions.length = 0;
    fake.respond = community44();
    _resetGraphSchemaCache();
    dir = mkdtempSync(join(tmpdir(), "extract-schema-"));
    out = [];
    err = [];
  });

  afterEach(async () => {
    _resetGraphSchemaCache();
    await closeDriver();
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("writes what the server's extractor produces, with the source fingerprint", async () => {
    const file = join(dir, "reactome-97-schema.json");
    expect(await run("--uri", URI, "--out", file)).toBe(0);
    const written = JSON.parse(readFileSync(file, "utf8"));

    expect(written.schemaFormat).toBe(SCHEMA_FORMAT);
    expect(written.source).toMatchObject({
      neo4jVersion: "4.4.40",
      neo4jEdition: "community",
      releaseNumber: 97,
      nodeCount: 3_000_000,
      relCount: 12_000_000,
    });
    expect(written.unavailable).toEqual([]);

    // One extractor: the same code, in the server, gives the same structure.
    _resetGraphSchemaCache();
    await closeDriver();
    process.env.NEO4J_URI = URI;
    process.env.MCP_ALLOW_CYPHER = "1";
    const served = JSON.parse(JSON.stringify(await fetchGraphSchema()));
    expect(untimed(written)).toEqual(untimed(served));
    expect(out.join("")).toBe("");
  });

  it("writes to stdout when no --out is given, and nothing else there", async () => {
    expect(await run("--uri", URI)).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.source.releaseNumber).toBe(97);
  });

  it("omits the release for a database without a DBInfo node", async () => {
    fake.respond = community44({ DBInfo: () => [] });
    expect(await run("--uri", URI)).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.source).not.toHaveProperty("releaseNumber");
    expect(parsed.source.nodeCount).toBe(3_000_000);
  });

  it("does not need MCP_ALLOW_CYPHER or NEO4J_URI in the environment", async () => {
    expect(process.env.MCP_ALLOW_CYPHER).toBeUndefined();
    expect(await run("--uri", URI)).toBe(0);
    expect(fake.drivers.map(d => d.uri)).toEqual([URI]);
  });

  it("reads only, under a timeout, against the database named", async () => {
    expect(await run("--uri", URI, "--database", "release97", "--user", "reader")).toBe(0);
    expect(fake.sessions.length).toBeGreaterThan(0);
    for (const s of fake.sessions) {
      expect(s.config.defaultAccessMode).toBe("READ");
      expect(s.config.database).toBe("release97");
      for (const r of s.runs) expect(r.config?.timeout).toBeGreaterThan(0);
    }
  });

  it("always extracts, even with NEO4J_SCHEMA_FILE inherited from the environment", async () => {
    // Otherwise a matching snapshot would be copied rather than regenerated.
    // A snapshot that matches this database, so the server would serve it.
    expect(await run("--uri", URI)).toBe(0);
    const matching = join(dir, "matching.json");
    writeFileSync(matching, out.join(""));
    _resetGraphSchemaCache();
    await closeDriver();
    fake.sessions.length = 0;
    out = [];

    process.env.NEO4J_SCHEMA_FILE = matching;
    expect(await run("--uri", URI)).toBe(0);
    expect(queriesRun(fake).some(q => q.includes("db.schema.nodeTypeProperties"))).toBe(true);
  });

  describe("passwords", () => {
    it.each([["--password", "hunter2"], ["--password=hunter2"], ["-p", "hunter2"]])(
      "refuses a password on the command line: %s",
      async (...flag) => {
        expect(await run("--uri", URI, ...flag)).toBe(2);
        expect(err.join("")).toMatch(/environment/i);
        expect(err.join("")).not.toContain("hunter2");
        expect(fake.drivers).toHaveLength(0);
      }
    );

    it("reads NEO4J_PASSWORD from the environment", async () => {
      process.env.NEO4J_PASSWORD = "from-env";
      expect(await run("--uri", URI, "--user", "reader")).toBe(0);
      expect(fake.drivers[0]?.auth).toEqual({
        scheme: "basic",
        principal: "reader",
        credentials: "from-env",
      });
    });

    it("reads the variable --password-env names", async () => {
      process.env.NEO4J_PASSWORD = "not-this-one";
      process.env.SNAPSHOT_PW = "this-one";
      expect(await run("--uri", URI, "--password-env", "SNAPSHOT_PW")).toBe(0);
      expect(fake.drivers[0]?.auth).toMatchObject({ credentials: "this-one" });
    });

    it("refuses a --password-env that names an unset variable", async () => {
      // Connecting without credentials instead would hide the typo.
      expect(await run("--uri", URI, "--password-env", "SNAPSHOT_PW")).toBe(2);
      expect(err.join("")).toContain("SNAPSHOT_PW");
      expect(fake.drivers).toHaveLength(0);
    });
  });

  it.each([
    [[], /--uri/],
    [["--uri"], /--uri/],
    [["--uri", URI, "--bogus"], /--bogus/],
    [["--uri", URI, "--out"], /--out/],
  ])("refuses %j with usage, connecting to nothing", async (args, message) => {
    expect(await run(...args)).toBe(2);
    expect(err.join("")).toMatch(message);
    expect(fake.drivers).toHaveLength(0);
  });

  it("prints usage for --help and connects to nothing", async () => {
    expect(await run("--help")).toBe(0);
    expect(out.join("")).toContain("--password-env");
    expect(fake.drivers).toHaveLength(0);
  });

  it("refuses to write an incomplete schema", async () => {
    // A snapshot is served for as long as the database matches; one with a
    // section missing would stay missing for all that time.
    fake.respond = community44({
      "db.schema.nodeTypeProperties": () => {
        throw new Error("The transaction has been terminated (timeout)");
      },
    });
    const file = join(dir, "schema.json");
    expect(await run("--uri", URI, "--out", file)).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(err.join("")).toContain("nodeTypeProperties");
  });

  it("leaves no shutdown listeners behind, however many times a driver is built", async () => {
    // Each build added SIGINT, SIGTERM and beforeExit listeners and nothing
    // removed them, so a process that closes and reconnects -- this CLI run
    // twice, the tests -- piled them up past Node's leak warning.
    const before = process.listenerCount("SIGINT");
    const beforeExit = process.listenerCount("beforeExit");
    for (let i = 0; i < 12; i++) {
      _resetGraphSchemaCache();
      expect(await run("--uri", URI)).toBe(0);
    }
    expect(process.listenerCount("SIGINT")).toBeLessThanOrEqual(before + 1);
    expect(process.listenerCount("beforeExit")).toBeLessThanOrEqual(beforeExit + 1);
  });

  it("fails, writing nothing, when the database does not answer", async () => {
    fake.respond = () => {
      throw new Error("Could not perform discovery. No routing servers available.");
    };
    const file = join(dir, "schema.json");
    expect(await run("--uri", URI, "--out", file)).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(err.join("")).toMatch(/schema/i);
  });
});
