#!/usr/bin/env node
// Live smoke test for the Cypher tools against a running Reactome Neo4j.
// Requires: NEO4J_URI set (e.g. bolt://localhost:7687) and the DB reachable.
// Not part of the automated test suite — run manually after `npm run build`.

import { isNeo4jConfigured, fetchGraphSchema, runRead } from "../dist/clients/neo4j.js";
import { capCypherRows } from "../dist/tools/cypher.js";

if (!isNeo4jConfigured()) {
  console.error("Set NEO4J_URI (e.g. bolt://localhost:7687) to run this smoke test.");
  process.exit(2);
}

async function main() {
  console.log("[smoke] fetching graph schema…");
  const schema = await fetchGraphSchema();
  console.log(`  labels: ${schema.labels.length}`);
  console.log(`  relationship types: ${schema.relationshipTypes.length}`);
  console.log(`  labels with properties: ${Object.keys(schema.propertiesByLabel).length}`);
  console.log(`  first 5 labels: ${schema.labels.slice(0, 5).join(", ")}`);

  console.log("[smoke] database info query…");
  const info = await runRead("CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition");
  console.log("  components:", JSON.stringify(info));

  console.log("[smoke] sampling Pathway nodes…");
  const pathways = await runRead(
    "MATCH (n:Pathway) RETURN n.stId AS stId, n.displayName AS name LIMIT $limit",
    { limit: 3 }
  );
  console.log("  pathways:", JSON.stringify(pathways, null, 2));

  console.log("[smoke] exercising capCypherRows with a wide row…");
  const wide = Array.from({ length: 5 }, () => ({ big: "x".repeat(4000) }));
  const { output, stats } = capCypherRows(wide, 10, 500, 40000);
  console.log(`  output rows: ${output.length}, stats: ${JSON.stringify(stats)}`);

  console.log("[smoke] OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
