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
 * Arguments that only make sense for one tool. Without these the sweep sends a
 * pathway stable ID to a tool that wants a complex, gets an honest 404, and
 * reports it as suspicious -- noise that would make a scheduled run red from
 * the first week and teach everyone to ignore it.
 */
const TOOL_ARGS = {
  reactome_complex_subunits: { id: "R-HSA-5672710" },
  reactome_entity_other_forms: { id: "R-HSA-69488" },
  reactome_complexes_containing: { resource: "UniProt", identifier: "P04637" },
  reactome_mapping_pathways: { resource: "UniProt", identifier: "P04637" },
  reactome_mapping_reactions: { resource: "UniProt", identifier: "P04637" },
  reactome_compare_species: { species: "48892" },
  // A correctly-spelled term legitimately returns nothing, which tells us
  // only that the call succeeded. A misspelling exercises the formatter.
  reactome_search_spellcheck: { query: "kinse" },
  reactome_psicquic_summary: { resource: "IntAct", accession: "P04637" },
  reactome_psicquic_details: { resource: "IntAct", accession: "P04637" },
};

/**
 * A reply that is the service reporting an error is the service answering, not
 * this repo rendering something wrong. Those are listed separately and do not
 * fail the run: Reactome returning 500 for a valid-looking orthology request is
 * not something a release of this package can fix.
 */
const SERVICE_ERROR = /^(Content Service|Analysis Service|MCP) error/;

/**
 * What a healthy answer looks like, for tools whose sweep arguments are known
 * to return data.
 *
 * Marker-grepping alone is not enough, and this repo has the scar to prove it:
 * `search_facets` rendered its heading, a total, and "*No facets available.*"
 * for months. No `undefined`, no empty body, nothing to grep for -- just a
 * confident report that there was nothing to report. Only an expectation of
 * what should be there can catch a field that was dropped cleanly.
 *
 * Every string below was observed in a real response. A failure here means
 * either this repo stopped rendering something, or Reactome stopped returning
 * it; both are worth a person looking.
 */
const EXPECT = {
  reactome_search_facets: ["### Types:", "### Species:"],
  reactome_search_suggest: ["- tp53"],
  reactome_search_spellcheck: ["Did you mean"],
  reactome_participants: ["### Complex", "["],
  reactome_entity_component_of: ["R-HSA-"],
  reactome_static_interactors: ["score:"],
  reactome_interactor_summary: ["Total interactions:"],
  reactome_psicquic_details: ["score:"],
  reactome_search_diagram: ["R-HSA-"],
  reactome_search: ["R-HSA-"],
  reactome_get_pathway: ["Stable ID"],
  reactome_top_pathways: ["R-HSA-"],
  reactome_species: ["Homo sapiens"],
  reactome_analyze_identifiers: ["R-HSA-"],
  reactome_complex_subunits: ["R-HSA-"],
  reactome_events_hierarchy: ["R-HSA-"],
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
  const serviceErrors = [];
  const unreachable = [];
  let called = 0;

  for (const tool of tools) {
    const required = tool.inputSchema?.required ?? [];
    const missing = required.filter(key => !(key in ARGS));
    if (missing.length > 0) {
      unreachable.push(`${tool.name} (needs ${missing.join(", ")})`);
      continue;
    }

    const overrides = TOOL_ARGS[tool.name] ?? {};
    const args = {
      ...Object.fromEntries(required.map(key => [key, ARGS[key]])),
      // Overrides may add optional arguments too, not just replace required
      // ones -- some tools only answer usefully when given a filter.
      ...overrides,
    };
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
    } else if (SERVICE_ERROR.test(text.trim())) {
      serviceErrors.push([tool.name, text.trim().slice(0, 120)]);
    } else if (text.trim().split("\n").filter(Boolean).length <= 1) {
      // A single line is a heading with no body -- either genuinely empty, or
      // a section that was skipped because a field was read at the wrong path.
      suspicious.push([tool.name, "empty body", text.trim().slice(0, 100)]);
    } else {
      const missing = (EXPECT[tool.name] ?? []).filter(needle => !text.includes(needle));
      if (missing.length > 0) {
        suspicious.push([
          tool.name,
          `missing ${missing.map(m => JSON.stringify(m)).join(", ")}`,
          text.trim().split("\n").slice(0, 2).join(" / ").slice(0, 100),
        ]);
      }
    }
  }

  child.kill();

  const toolNames = new Set(tools.map(t => t.name));
  const unknownExpectations = Object.keys(EXPECT).filter(name => !toolNames.has(name));

  console.log(`\ncalled ${called} of ${tools.length} tools`);
  console.log(
    `checked content expectations for ${Object.keys(EXPECT).length - unknownExpectations.length} of them`
  );
  if (unknownExpectations.length > 0) {
    // A typo here would silently verify nothing, which is the failure mode
    // this whole script exists to catch.
    console.log(
      `  WARNING: expectations named tools that do not exist: ${unknownExpectations.join(", ")}`
    );
  }

  if (unreachable.length > 0) {
    console.log(`\n${unreachable.length} not reachable with known arguments:`);
    for (const line of unreachable) console.log(`  ${line}`);
  }

  if (serviceErrors.length > 0) {
    console.log(`\n${serviceErrors.length} returned a service error (not a failure of this repo):`);
    for (const [name, sample] of serviceErrors) console.log(`  ${name}\n      ${sample}`);
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
  return 1;
}

main().then(
  code => process.exit(code),
  error => {
    console.error(error);
    process.exit(2);
  }
);
