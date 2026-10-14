#!/usr/bin/env node
// Live smoke test for the Cypher tools against a running Reactome graph database.
// Requires: NEO4J_URI (e.g. bolt://127.0.0.1:7687) and MCP_ALLOW_CYPHER=1, and
// the database reachable. Read-only. Not part of the automated test suite --
// run manually after `npm run build`. Never point it at a database you do not
// own.

import { isGraphAccessEnabled } from "../dist/graph/gate.js";
import { runRead, closeDriver } from "../dist/clients/neo4j.js";
import { fetchGraphSchema } from "../dist/graph/schema.js";
import { formatGraphSchemaMarkdown } from "../dist/graph/format-schema.js";

if (!isGraphAccessEnabled()) {
  console.error("Set NEO4J_URI and MCP_ALLOW_CYPHER=1 to run this smoke test.");
  process.exit(2);
}

async function main() {
  console.log("[smoke] database components…");
  console.log(
    " ",
    JSON.stringify(await runRead("CALL dbms.components() YIELD name, versions, edition RETURN *"))
  );

  console.log("[smoke] fetching graph schema (built-in procedures only)…");
  const started = Date.now();
  const schema = await fetchGraphSchema();
  console.log(`  took ${Date.now() - started} ms`);
  console.log(`  nodes: ${schema.stats.nodeCount}, relationships: ${schema.stats.relCount}`);
  console.log(`  labels: ${Object.keys(schema.stats.labels).length}`);
  console.log(`  relationship types: ${Object.keys(schema.stats.relTypesCount).length}`);
  console.log(`  patterns: ${schema.patterns.length}`);
  console.log(`  node property rows: ${schema.nodeTypeProperties.length}`);
  console.log(`  rel property rows: ${schema.relTypeProperties.length}`);
  console.log(`  indexes: ${schema.indexes.length}, constraints: ${schema.constraints.length}`);
  console.log(`  unavailable: ${JSON.stringify(schema.unavailable)}`);
  console.log(`  digest: ${formatGraphSchemaMarkdown(schema).length} chars`);

  console.log("[smoke] sampling Pathway nodes…");
  const pathways = await runRead(
    "MATCH (n:Pathway) RETURN n.stId AS stId, n.displayName AS name LIMIT $limit",
    { limit: 3 }
  );
  console.log("  pathways:", JSON.stringify(pathways));

  console.log("[smoke] a write is refused by the READ-mode session…");
  try {
    await runRead("CREATE (n:SmokeTestShouldNotExist) RETURN n");
    console.log("  FAIL: the write was accepted");
    process.exitCode = 1;
  } catch (error) {
    console.log("  OK:", String(error?.message ?? error).slice(0, 120));
  }

  await closeDriver();
  console.log(process.exitCode ? "[smoke] FAILED" : "[smoke] OK");
}

main().catch(async err => {
  console.error("[smoke] FAILED:", err);
  await closeDriver();
  process.exit(1);
});
