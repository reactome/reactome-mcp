import { describe, it, expect } from "vitest";
import {
  rejectWriteThroughCalls,
  WriteThroughRejected,
} from "../src/tools/cypher-guard.js";

describe("rejectWriteThroughCalls", () => {
  it("accepts a plain read query", () => {
    expect(() =>
      rejectWriteThroughCalls("MATCH (n:Pathway) RETURN n LIMIT 10")
    ).not.toThrow();
  });

  it("accepts queries that mention apoc in a string literal if no procedure call", () => {
    // This is a query that reads only — "apoc" appears inside a string and
    // the regex uses word-boundary procedure shape, so it won't match.
    expect(() =>
      rejectWriteThroughCalls(`MATCH (n) WHERE n.note = 'see apoc docs' RETURN n`)
    ).not.toThrow();
  });

  it("rejects apoc.cypher.runWrite", () => {
    expect(() =>
      rejectWriteThroughCalls("CALL apoc.cypher.runWrite('CREATE (n) RETURN n', {})")
    ).toThrow(WriteThroughRejected);
  });

  it("rejects apoc.cypher.doIt regardless of case", () => {
    expect(() =>
      rejectWriteThroughCalls("CALL APOC.CYPHER.DOIT('CREATE (n)', {})")
    ).toThrow(WriteThroughRejected);
  });

  it("rejects apoc.periodic.iterate", () => {
    expect(() =>
      rejectWriteThroughCalls(
        "CALL apoc.periodic.iterate('MATCH (n) RETURN n', 'SET n.flag = 1', {})"
      )
    ).toThrow(WriteThroughRejected);
  });

  it("rejects apoc.create.node", () => {
    expect(() =>
      rejectWriteThroughCalls("CALL apoc.create.node(['X'], {}) YIELD node RETURN node")
    ).toThrow(WriteThroughRejected);
  });

  it("rejects apoc.refactor.mergeNodes", () => {
    expect(() =>
      rejectWriteThroughCalls("CALL apoc.refactor.mergeNodes([n1, n2])")
    ).toThrow(WriteThroughRejected);
  });

  it("rejects apoc.load.json (SSRF risk)", () => {
    expect(() =>
      rejectWriteThroughCalls(
        "CALL apoc.load.json('http://evil.example/data') YIELD value RETURN value"
      )
    ).toThrow(WriteThroughRejected);
  });

  it("rejects apoc.export.csv.all", () => {
    expect(() =>
      rejectWriteThroughCalls("CALL apoc.export.csv.all('/tmp/x.csv', {})")
    ).toThrow(WriteThroughRejected);
  });

  it("rejects apoc.nodes.delete", () => {
    expect(() =>
      rejectWriteThroughCalls("CALL apoc.nodes.delete([1,2,3], 100)")
    ).toThrow(WriteThroughRejected);
  });

  it("strips line comments so commented-out bad calls are ignored", () => {
    expect(() =>
      rejectWriteThroughCalls(
        "// CALL apoc.cypher.runWrite('...')\nMATCH (n) RETURN n"
      )
    ).not.toThrow();
  });

  it("does not strip comments when the bad call is in active code", () => {
    expect(() =>
      rejectWriteThroughCalls(
        "// harmless comment\nCALL apoc.periodic.commit('DELETE n', {})"
      )
    ).toThrow(WriteThroughRejected);
  });

  it("accepts read-only apoc procedures (apoc.meta.schema, apoc.path.*)", () => {
    expect(() =>
      rejectWriteThroughCalls("CALL apoc.meta.schema() YIELD value RETURN value")
    ).not.toThrow();
    expect(() =>
      rejectWriteThroughCalls(
        "MATCH (n) CALL apoc.path.subgraphAll(n, {}) YIELD nodes RETURN nodes"
      )
    ).not.toThrow();
  });
});
