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
    accepted("MATCH (n) WHERE n.displayName STARTS WITH 'Signal' RETURN n.stId LIMIT 5");
    accepted("MATCH (n:Pathway) RETURN n.create, n.set, n.delete, n.use LIMIT 1");
    accepted("RETURN {set: 1, delete: 2, call: 3} AS m");
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
      // Backtick-quoted parts are the same name once unquoted.
      "CALL `db`.`labels`() YIELD label RETURN label",
      "CALL db.`schema`.nodeTypeProperties()",
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

  it("a comment opener inside a line comment or a string", () => {
    // Regex passes over the whole text treated `/*` inside a `//` comment as
    // opening a block comment, and swallowed what Neo4j actually runs.
    refused("// /*\nLOAD/**/CSV FROM 'http://x/' AS r RETURN r");
    refused("// /*\nUSE/**/otherdb MATCH (n) RETURN n");
    refused(
      "// /*\nRETURN apoc/**/.cypher.runFirstColumnSingle('CA'+'LL dbms.listQueries() YIELD queryId RETURN queryId', {})"
    );
    refused("RETURN '/*' AS a // */\nLOAD CSV FROM 'http://x/' AS r RETURN r");
    refused('RETURN "/*" AS a\nCALL dbms.listConfig() // */');
    refused("RETURN '\\'/*' AS a\nCALL dbms.listConfig()");
  });

  it("separators Cypher treats as whitespace, and tokens run together", () => {
    refused("LOAD\u001CCSV FROM 'http://x/' AS r RETURN r");
    refused("USE\u001Cdb MATCH (n) RETURN n");
    refused("RETURN apoc\u001C.text.join(['a'], ',')");
    refused("MATCH (n) RETURN n LIMIT 1CALL dbms.listConfig()");
    refused("LOAD\u00A0CSV FROM 'http://x/' AS r RETURN r");
    refused("LOAD\u2003CSV FROM 'http://x/' AS r RETURN r");
    refused("LOAD\u0085CSV FROM 'http://x/' AS r RETURN r");
  });

  it("a line separator a comment might or might not end at", () => {
    refused("// x\u2028LOAD CSV FROM 'http://x/' AS r RETURN r");
    refused("// it's\u2029MATCH (n) RETURN n");
  });

  it("anything it cannot finish reading", () => {
    refused("MATCH (n) RETURN 'unterminated");
    refused('MATCH (n) RETURN "unterminated');
    refused("MATCH (n) RETURN n /* unterminated");
    refused("MATCH (n) RETURN n.`unterminated");
  });
});

describe("assertReadOnlyQuery: ignores what Neo4j ignores", () => {
  it("text inside comments and string literals", () => {
    accepted("// CALL apoc.cypher.runWrite('...')\nMATCH (n) RETURN n LIMIT 1");
    accepted("/* LOAD CSV FROM 'x' */ MATCH (n) RETURN n LIMIT 1");
    accepted("MATCH (n) WHERE n.name = 'USE system; CALL dbms.listConfig()' RETURN n LIMIT 1");
    accepted('MATCH (n) WHERE n.name = "it\\"s apoc.x" RETURN n LIMIT 1');
  });
});

describe("assertReadOnlyQuery: refuses writes and admin as keywords", () => {
  it("write and administration clauses", () => {
    for (const q of [
      "CREATE (n:X) RETURN n",
      "MATCH (n) SET n.x = 1",
      "MATCH (n) DETACH DELETE n",
      "MATCH (n) REMOVE n.x",
      "MERGE (n:X {id: 1})",
      "DROP INDEX x",
      "GRANT ROLE admin TO bob",
      "DENY READ {*} ON GRAPH * TO bob",
      "REVOKE ROLE admin FROM bob",
      "ALTER USER bob SET PASSWORD 'x'",
      "START DATABASE neo4j",
      "STOP DATABASE neo4j",
      "USING PERIODIC COMMIT LOAD CSV FROM 'x' AS r RETURN r",
    ]) {
      refused(q);
    }
  });

  it("CALL subqueries, which are not needed to read and can run in transactions", () => {
    refused("MATCH (n) WITH n LIMIT 5 CALL { WITH n RETURN n.dbId AS id } RETURN id");
    refused("MATCH (n) CALL (n) { RETURN n.dbId AS id } RETURN id");
  });

  it("fulltext procedures that create or drop, though querying is allowed", () => {
    refused("CALL db.index.fulltext.createNodeIndex('x', ['X'], ['y'])");
    refused("CALL db.index.fulltext.drop('x')");
    accepted("CALL db.index.fulltext.queryNodes('x', 'y') YIELD node RETURN node LIMIT 5");
    accepted(
      "CALL db.index.fulltext.queryRelationships('x', 'y') YIELD relationship RETURN relationship"
    );
  });
});

describe("assertReadOnlyQuery: number literals", () => {
  it("are read whole, and refused when a name runs straight on from one", () => {
    // Reading only the leading digits of 1e0CALL left `e0CALL` as one name,
    // so the CALL was never seen. Neo4j reads 1e0 and then CALL.
    for (const q of [
      "MATCH (n) WHERE n.x = 1e0CALL dbms.listQueries() YIELD queryId RETURN queryId",
      "MATCH (n) WITH n LIMIT 1E0LOAD CSV FROM 'http://x/' AS r RETURN r",
      "WITH 1 AS a LIMIT 0x1LOAD CSV FROM 'http://x/' AS r RETURN r",
      "MATCH (n) WHERE n.x = 1.5e3DELETE n",
      "RETURN 1e0CALL{ MATCH (n) RETURN n }",
      "MATCH (n) WHERE n.x = .5e1DETACH n",
      "MATCH (n) WHERE n.x = 0o7LOAD CSV FROM 'x' AS r RETURN r",
      "MATCH (n) WHERE n.x = 1_000 RETURN n",
      "MATCH (n) WHERE n.x = 1e+5CALL dbms.listConfig() RETURN n",
    ]) {
      refused(q);
    }
  });

  it("in their ordinary forms", () => {
    for (const q of [
      "MATCH (n) WHERE n.x = 1.5e3 RETURN n LIMIT 10",
      "MATCH (n) WHERE n.x > .5 AND n.y < 1E-3 RETURN n",
      "MATCH (n) WHERE n.x = 0x1F OR n.x = 0o17 OR n.x = 017 RETURN n",
      "MATCH p = (a)-[*1..3]->(b) RETURN p LIMIT 5",
      "RETURN [1,2,3][0..2] AS xs",
      "RETURN 1+2-3*4/5%6^7 AS x",
    ]) {
      accepted(q);
    }
  });
});

describe("assertReadOnlyQuery: plugin namespaces", () => {
  it("refuses apoc and gds however the name is quoted", () => {
    for (const q of [
      "RETURN `apoc.text.join`(['a'], ',')",
      "CALL `apoc.util.sleep`(1000)",
      "RETURN `APOC`.text.join(['a'], ',')",
      "CALL gds.graph.project('g', '*', '*')",
      "RETURN gds.util.asNode(1)",
      "CALL `gds.graph.drop`('g')",
      "RETURN `gds`.version()",
    ]) {
      refused(q);
    }
  });
});

describe("assertReadOnlyQuery: names that are keywords elsewhere", () => {
  it("accepts start and stop as variables; refuses only START/STOP DATABASE", () => {
    accepted("MATCH p=(start:Pathway)-[:hasEvent]->(e) RETURN start.displayName LIMIT 5");
    accepted("MATCH (a:Pathway) WITH a AS start RETURN start.stId LIMIT 5");
    accepted("MATCH (stop:Pathway) RETURN stop LIMIT 1");
    refused("START DATABASE neo4j");
    refused("STOP DATABASE neo4j");
    refused("start   database neo4j");
  });

  it("accepts use as a variable; refuses USE where a query or a UNION part starts", () => {
    accepted("MATCH (use:Pathway) RETURN use.stId LIMIT 1");
    accepted("WITH 1 AS use RETURN use");
    refused("USE system SHOW USERS");
    refused("EXPLAIN USE neo4j MATCH (n) RETURN n");
    refused("PROFILE USE neo4j MATCH (n) RETURN n");
    refused("MATCH (n) RETURN n.x AS x UNION USE other MATCH (n) RETURN n.x AS x");
    refused("MATCH (n) RETURN n.x AS x UNION ALL USE other MATCH (n) RETURN n.x AS x");
    refused("RETURN 1 AS x; USE system SHOW USERS");
    refused("MATCH (n) WHERE EXISTS { USE other MATCH (m) RETURN m } RETURN n");
  });
});
