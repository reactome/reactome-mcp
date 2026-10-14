#!/usr/bin/env node
// Verify the write-through guard and the Cypher query timeout against a live
// database. Requires NEO4J_URI and MCP_ALLOW_CYPHER=1. Uses a short timeout on
// a deliberately slow read to force the server to terminate it. Needs no APOC.
// Keep the range modest: range() builds its list before the transaction guard
// gets a look in, so a huge one costs the database memory regardless.

import { rejectWriteThroughCalls } from "../dist/tools/cypher-guard.js";
import { runRead, closeDriver } from "../dist/clients/neo4j.js";

let failures = 0;

for (const query of [
  "CALL apoc.cypher.runWrite('CREATE (n)', {})",
  "LOAD CSV FROM 'http://example.invalid/x.csv' AS row RETURN row",
]) {
  try {
    rejectWriteThroughCalls(query);
    console.log("FAIL: guard did not reject:", query);
    failures++;
  } catch (e) {
    console.log("OK: guard rejected —", e.message.slice(0, 80));
  }
}

try {
  rejectWriteThroughCalls("MATCH (n:Pathway) RETURN n LIMIT 1");
  console.log("OK: guard accepts a plain read query");
} catch (e) {
  console.log("FAIL: guard rejected a plain read query:", e.message);
  failures++;
}

try {
  await runRead(
    "UNWIND range(1, 20000000) AS x WITH x WHERE x % 7 = 0 RETURN count(x)",
    {},
    { timeoutMs: 300 }
  );
  console.log("FAIL: expected timeout but runRead returned");
  failures++;
} catch (e) {
  const msg = String(e?.message ?? e);
  if (/timeout|terminated|Transaction/i.test(msg)) {
    console.log("OK: timeout fired —", msg.slice(0, 120));
  } else {
    console.log("UNEXPECTED error:", msg.slice(0, 200));
    failures++;
  }
}

await closeDriver();
process.exit(failures > 0 ? 1 : 0);
