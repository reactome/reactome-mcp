import { describe, it, expect } from "vitest";
import { assertReadOnlyQuery, QueryRejected } from "../src/tools/cypher-guard.js";

/**
 * The query guard is an allowlist. A query may CALL only the read-only
 * built-ins the schema tooling uses; every other procedure, every APOC name,
 * LOAD CSV, USE, and any SHOW other than indexes and constraints is refused
 * before it reaches the database.
 *
 * It is a guardrail, not the boundary -- the boundary is that graph access is
 * off on any publicly reachable instance -- but a denylist is a list of the
 * ways somebody already thought of, and the review found eleven it missed.
 */

const accepted = (query: string) => expect(() => assertReadOnlyQuery(query)).not.toThrow();
const refused = (query: string) => expect(() => assertReadOnlyQuery(query)).toThrow(QueryRejected);

describe("assertReadOnlyQuery: what is allowed", () => {
  it("accepts plain read queries", () => {
    accepted("MATCH (n:Pathway) RETURN n LIMIT 10");
    accepted("MATCH (p:Pathway {stId: $id})-[:hasEvent]->(e) RETURN e.displayName LIMIT 25");
    accepted("MATCH (n) WITH n LIMIT 5 CALL { WITH n RETURN n.dbId AS id } RETURN id");
  });

  it("accepts apoc, call, use and load as words inside data", () => {
    accepted(`MATCH (n) WHERE n.note = 'see apoc docs' RETURN n`);
    accepted("MATCH (n) RETURN n.csv, n.load, n.use LIMIT 1");
  });

  it("accepts the read-only built-in procedures", () => {
    for (const q of [
      "CALL db.labels() YIELD label RETURN label",
      "CALL db.relationshipTypes()",
      "CALL db.propertyKeys()",
      "CALL db.schema.nodeTypeProperties()",
      "CALL db.schema.relTypeProperties()",
      "CALL db.schema.visualization()",
      "CALL db.indexes()",
      "CALL db.constraints()",
      "CALL dbms.components() YIELD name, versions, edition RETURN *",
      "call DB.LABELS()",
      "SHOW INDEXES",
      "SHOW ALL INDEXES YIELD name RETURN name",
      "SHOW CONSTRAINTS",
      "SHOW UNIQUE CONSTRAINTS",
    ]) {
      accepted(q);
    }
  });
});

describe("assertReadOnlyQuery: refuses", () => {
  it("every APOC name, called or not", () => {
    for (const q of [
      "CALL apoc.cypher.runWrite('CREATE (n) RETURN n', {})",
      "CALL APOC.CYPHER.DOIT('CREATE (n)', {})",
      "CALL apoc.periodic.iterate('MATCH (n) RETURN n', 'SET n.flag = 1', {})",
      "CALL apoc.create.node(['X'], {}) YIELD node RETURN node",
      "CALL apoc.refactor.mergeNodes([n1, n2])",
      "CALL apoc.load.json('http://evil.example/data') YIELD value RETURN value",
      "CALL apoc.export.csv.all('/tmp/x.csv', {})",
      "CALL apoc.nodes.delete([1,2,3], 100)",
      "CALL apoc.meta.schema() YIELD value RETURN value",
      "MATCH (n) CALL apoc.path.subgraphAll(n, {}) YIELD nodes RETURN nodes",
      // The review's list: none of these was on the old denylist.
      "CALL apoc.cypher.runMany('CREATE (n);', {})",
      "CALL apoc.cypher.runFile('x.cypher')",
      "CALL apoc.cypher.runSchema('CREATE INDEX FOR (n:X) ON (n.y)', {})",
      "CALL apoc.cypher.parallel('MATCH (n) RETURN n', {}, 'x')",
      "CALL apoc.schema.assert({}, {})",
      "CALL apoc.util.sleep(600000)",
      "CALL apoc.custom.asProcedure('x', 'CREATE (n)')",
      "CALL apoc.systemdb.execute('SHOW USERS')",
      "CALL apoc.lock.nodes([n])",
      "RETURN apoc.text.join(['a'], ',')",
    ]) {
      refused(q);
    }
  });

  it("dbms and db procedures outside the allowlist", () => {
    for (const q of [
      "CALL dbms.killQuery('query-1')",
      "CALL dbms.listQueries()",
      "CALL dbms.listConfig()",
      "CALL dbms.security.createUser('x', 'y', false)",
      "CALL db.createLabel('X')",
      "CALL db.index.fulltext.createNodeIndex('x', ['X'], ['y'])",
      "CALL db.clearQueryCaches()",
      "CALL db.stats.retrieve('GRAPH COUNTS')",
      // A known name with a suffix is a different procedure.
      "CALL db.labelsAndMore()",
    ]) {
      refused(q);
    }
  });

  it("USE, which switches database -- system included", () => {
    refused("USE system SHOW USERS");
    refused("use neo4j MATCH (n) RETURN n LIMIT 1");
    refused("CALL { USE system RETURN 1 AS x } RETURN x");
  });

  it("SHOW and TERMINATE other than indexes and constraints", () => {
    refused("SHOW TRANSACTIONS");
    refused("SHOW PROCEDURES");
    refused("SHOW DATABASES");
    refused("TERMINATE TRANSACTIONS 'neo4j-transaction-1'");
  });

  it("LOAD CSV, which READ mode allows and which fetches URLs and files", () => {
    refused("LOAD CSV FROM 'http://evil.example/x.csv' AS row RETURN row");
    refused("load   csv with headers from 'file:///etc/passwd' as r return r");
  });
});

describe("assertReadOnlyQuery: is not bypassed by", () => {
  it("a comment splitting a keyword", () => {
    // Comments used to be deleted outright, so LOAD/**/CSV became LOADCSV and
    // matched nothing. A comment separates tokens; it is read as a space.
    refused("LOAD/**/CSV FROM 'http://x' AS r RETURN r");
    refused("LOAD/* a */CSV FROM 'http://x' AS r RETURN r");
    refused("LOAD//\nCSV FROM 'http://x' AS r RETURN r");
    refused("CALL/**/dbms.listConfig()");
    refused("CALL/**/apoc.util.sleep(1000)");
    refused("USE/**/system SHOW USERS");
    refused("SHOW/**/TRANSACTIONS");
  });

  it("a comment splitting a procedure name", () => {
    refused("CALL apoc.load/* x */.json('http://evil.example/') YIELD value");
    refused("CALL dbms/* x */.listConfig()");
  });

  it("backtick-quoting or spacing the name", () => {
    refused("CALL `apoc`.`load`.`json`('http://evil.example/') YIELD value");
    refused("CALL `dbms`.`listConfig`()");
    refused("CALL dbms . listConfig ( )");
    refused("CALL `dbms.listConfig`()");
  });

  it("a '//' inside a string literal", () => {
    refused(
      "WITH 'http://x' AS u CALL apoc.load.json('http://evil.example/') YIELD value RETURN value"
    );
    refused("WITH 'a//' AS s CALL dbms.listConfig() YIELD name RETURN name");
  });

  it("hiding the call inside a comment (a commented-out call is refused too)", () => {
    refused("// CALL apoc.cypher.runWrite('...')\nMATCH (n) RETURN n");
  });
});
