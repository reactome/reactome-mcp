#!/usr/bin/env node
// Verify the APOC write-through guard and the Cypher query timeout.
// Requires NEO4J_URI and a running Neo4j. Uses a short timeout to force it.

import { rejectWriteThroughCalls } from "../dist/tools/cypher-guard.js";
import { runRead } from "../dist/clients/neo4j.js";

let failures = 0;

try {
  rejectWriteThroughCalls("CALL apoc.cypher.runWrite('CREATE (n)', {})");
  console.log("FAIL: guard did not reject apoc.cypher.runWrite");
  failures++;
} catch (e) {
  console.log("OK: guard rejected apoc.cypher.runWrite —", e.message.slice(0, 80));
}

try {
  rejectWriteThroughCalls("MATCH (n:Pathway) RETURN n LIMIT 1");
  console.log("OK: guard accepts a plain read query");
} catch (e) {
  console.log("FAIL: guard rejected a plain read query:", e.message);
  failures++;
}

// Force a server-side timeout via apoc.util.sleep which blocks for a known duration.
try {
  await runRead("CALL apoc.util.sleep(5000) RETURN 1", {}, { timeoutMs: 300 });
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

process.exit(failures > 0 ? 1 : 0);
