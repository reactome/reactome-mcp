#!/usr/bin/env node
/**
 * Call every reachable tool against the live Reactome services and report
 * output that looks wrong.
 *
 * Unit tests pin shapes we already know about. They cannot tell us that an
 * endpoint changed, that a default argument produces HTTP 500, or that a tool
 * nobody calls has never worked. This can, and it is how nine formatters were
 * found reading field paths the API does not return.
 *
 * It is deliberately not part of `npm test`: it needs the network and it hits
 * a production service. Run it before a release, and after touching any
 * formatter.
 *
 *   npm run build && npm run sweep
 *
 * Exit status is 1 if anything suspicious was rendered, so CI can gate on it.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

const TIMEOUT_MS = 120_000;

/**
 * Arguments good enough to exercise each tool. `token` is filled in at run
 * time from a real analysis; anything still missing an argument is reported as
 * unreachable rather than silently skipped, because unreachable tools are
 * exactly where bugs accumulate.
 */
const ARGS = {
  id: "R-HSA-109581",
  pathway: "R-HSA-109581",
  identifier: "TP53",
  identifiers: ["TP53", "BRCA1"],
  query: "TP53",
  term: "TP53",
  name: "TP53",
  species: "9606",
  taxId: "9606",
  dbId: "109581",
  db_id: 109581,
  stId: "R-HSA-109581",
  pathwayId: "R-HSA-109581",
  diagram: "R-HSA-109581",
  accession: "P04637",
  resource: "IntAct",
  ext: "png",
  format: "png",
  type: "pathways",
  pathways: ["R-HSA-109581"],
};

/**
 * Markers of a formatter that read a field the API did not return. "undefined"
 * and "[object Object]" are the loud cases; a body with nothing in it is the
 * quiet one, and the quiet one is why `search_facets` went unnoticed.
 */
const MARKERS = ["undefined", "[object Object]", "NaN"];

function startServer() {
  const child = spawn("node", ["dist/index.js"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const rl = createInterface({ input: child.stdout });
  const pending = new Map();

  rl.on("line", line => {
    if (!line.startsWith("{")) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  let nextId = 1;
  const send = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timed out: ${method} ${JSON.stringify(params?.name ?? "")}`));
      }, TIMEOUT_MS);
      pending.set(id, msg => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  };

  const notify = method => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  };

  return { child, send, notify };
}

async function main() {
  const { child, send, notify } = startServer();

  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "sweep-live", version: "0" },
  });
  notify("notifications/initialized");

  const listed = await send("tools/list", {});
  const tools = listed.result?.tools ?? [];

  const callTool = async (name, args) => {
    const reply = await send("tools/call", { name, arguments: args });
    return reply.result?.content?.[0]?.text ?? null;
  };

  // Unlock the token-gated analysis tools with a real analysis. All seven were
  // untested when a token-parsing bug shipped.
  try {
    const text = await callTool("reactome_analyze_identifiers", {
      identifiers: ["TP53", "BRCA1", "EGFR", "MYC"],
    });
    const match = text?.match(/token[:*\s`]*([A-Za-z0-9%=+/_-]{8,})/i);
    if (match) ARGS.token = match[1];
  } catch {
    // Leave token unset; the analysis tools will be reported as unreachable.
  }
  console.log(ARGS.token ? `analysis token: ${ARGS.token}` : "analysis token: NOT OBTAINED");

  const suspicious = [];
  const unreachable = [];
  let called = 0;

  for (const tool of tools) {
    const required = tool.inputSchema?.required ?? [];
    const missing = required.filter(key => !(key in ARGS));
    if (missing.length > 0) {
      unreachable.push(`${tool.name} (needs ${missing.join(", ")})`);
      continue;
    }

    const args = Object.fromEntries(required.map(key => [key, ARGS[key]]));
    let text;
    try {
      text = await callTool(tool.name, args);
    } catch (error) {
      suspicious.push([tool.name, "call failed", error.message]);
      continue;
    }
    called++;
    if (text === null) continue;

    const hits = MARKERS.filter(marker => text.includes(marker));
    if (hits.length > 0) {
      const line = text.split("\n").find(l => hits.some(h => l.includes(h))) ?? "";
      suspicious.push([tool.name, hits.join(", "), line.trim().slice(0, 100)]);
    } else if (text.trim().split("\n").filter(Boolean).length <= 1) {
      // A single line is a heading with no body -- either genuinely empty, or
      // a section that was skipped because a field was read at the wrong path.
      suspicious.push([tool.name, "empty body", text.trim().slice(0, 100)]);
    }
  }

  child.kill();

  console.log(`\ncalled ${called} of ${tools.length} tools`);

  if (unreachable.length > 0) {
    console.log(`\n${unreachable.length} not reachable with known arguments:`);
    for (const line of unreachable) console.log(`  ${line}`);
  }

  if (suspicious.length === 0) {
    console.log("\nno suspicious output");
    return 0;
  }

  console.log(`\n${suspicious.length} suspicious:`);
  for (const [name, why, sample] of suspicious) {
    console.log(`  ${name}  [${why}]`);
    if (sample) console.log(`      ${sample}`);
  }
  console.log(
    "\nSome of these are the service answering a deliberately odd argument" +
      " with a 404 or 500. Read each one before treating it as a bug."
  );
  return 1;
}

main().then(
  code => process.exit(code),
  error => {
    console.error(error);
    process.exit(2);
  }
);
