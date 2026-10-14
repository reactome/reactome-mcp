import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FakeNeo4jState } from "./helpers/fake-neo4j.js";

/**
 * The Cypher tools, driven through the registration path with a fake driver.
 *
 * What these hold is the read-only contract: every query runs in a READ
 * session under a server-side timeout, the write-through guard refuses before
 * a session is even opened, and the response caps apply.
 */

const fake = vi.hoisted((): FakeNeo4jState => ({ drivers: [], sessions: [], respond: () => [] }));

vi.mock("neo4j-driver", async () => {
  const { fakeNeo4jModule } = await import("./helpers/fake-neo4j.js");
  return fakeNeo4jModule(fake);
});

import { createFakeServer, textOf } from "./helpers/fake-server.js";
import { registerCypherTools } from "../src/tools/cypher.js";
import { closeDriver } from "../src/clients/neo4j.js";
import { CYPHER_QUERY_TIMEOUT_MS } from "../src/config.js";

describe("reactome_cypher_* tools", () => {
  let fakeServer: ReturnType<typeof createFakeServer>;

  beforeEach(() => {
    process.env.NEO4J_URI = "bolt://127.0.0.1:7687";
    process.env.MCP_ALLOW_CYPHER = "1";
    fake.drivers.length = 0;
    fake.sessions.length = 0;
    fake.respond = () => [];
    fakeServer = createFakeServer();
    registerCypherTools(fakeServer.server);
  });

  afterEach(async () => {
    await closeDriver();
    delete process.env.NEO4J_URI;
    delete process.env.MCP_ALLOW_CYPHER;
  });

  it("registers the three tools when the gate is open", () => {
    expect(fakeServer.toolNames().sort()).toEqual([
      "reactome_cypher_query",
      "reactome_cypher_sample",
      "reactome_cypher_schema",
    ]);
  });

  it("runs a query in a READ session, under the configured timeout", async () => {
    fake.respond = () => [{ stId: "R-HSA-109582" }];
    const result = await fakeServer.invoke("reactome_cypher_query", {
      query: "MATCH (p:Pathway) RETURN p.stId AS stId LIMIT 1",
    });

    expect(textOf(result)).toContain("R-HSA-109582");
    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0]?.config.defaultAccessMode).toBe("READ");
    expect(fake.sessions[0]?.runs[0]?.config?.timeout).toBe(CYPHER_QUERY_TIMEOUT_MS);
    expect(fake.sessions[0]?.closed).toBe(true);
  });

  it("refuses a write-through procedure before opening a session", async () => {
    await expect(
      fakeServer.invoke("reactome_cypher_query", {
        query: "CALL apoc.periodic.iterate('MATCH (n) RETURN n', 'DETACH DELETE n', {})",
      })
    ).rejects.toThrow(/bypass READ-mode/);
    expect(fake.drivers).toHaveLength(0);
    expect(fake.sessions).toHaveLength(0);
  });

  it("caps the rows it returns", async () => {
    fake.respond = () => Array.from({ length: 500 }, (_, i) => ({ i }));
    const result = await fakeServer.invoke("reactome_cypher_query", {
      query: "UNWIND range(1, 500) AS i RETURN i",
      max_rows: 10,
    });
    expect(textOf(result)).toContain("**Rows returned:** 10 of 500");
  });

  it("refuses a max_rows above the cap, before running anything", () => {
    expect(() =>
      fakeServer.invoke("reactome_cypher_query", { query: "RETURN 1", max_rows: 1_000_000 })
    ).toThrow(/<=1000/);
    expect(fake.sessions).toHaveLength(0);
  });

  it("samples a label read-only, and refuses a label that could inject Cypher", async () => {
    fake.respond = () => [{ n: { stId: "R-HSA-1" } }];
    const ok = await fakeServer.invoke("reactome_cypher_sample", { label: "Pathway" });
    expect(textOf(ok)).toContain("R-HSA-1");
    expect(fake.sessions[0]?.config.defaultAccessMode).toBe("READ");

    await expect(
      fakeServer.invoke("reactome_cypher_sample", { label: "Pathway`) DETACH DELETE n //" })
    ).rejects.toThrow(/Invalid label/);
  });
});

describe("reactome_cypher_* tools with the gate closed", () => {
  it("registers nothing, even when called directly", () => {
    delete process.env.NEO4J_URI;
    delete process.env.MCP_ALLOW_CYPHER;
    const fakeServer = createFakeServer();
    registerCypherTools(fakeServer.server);
    expect(fakeServer.toolNames()).toEqual([]);
  });
});
