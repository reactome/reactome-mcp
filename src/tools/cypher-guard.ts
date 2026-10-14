// Guard against queries that get around a READ-mode session.
//
// Neo4j's READ access mode rejects native write clauses (CREATE/MERGE/DELETE/
// SET/REMOVE). It does not reject everything that reaches outside the graph:
//
//   - APOC procedures open their own transactions and can write, load remote
//     URLs or touch the filesystem regardless of the calling session's mode.
//     The Reactome graph database container ships without APOC, but a
//     database this server is pointed at might not, so they are refused here.
//   - LOAD CSV is a *read* clause, so READ mode allows it -- and it fetches
//     arbitrary URLs and, depending on server config, local files.
//
// This is a guardrail, not a security boundary. A determined caller can hide
// intent in ways a pattern cannot see, and the real boundary is that graph
// access is never enabled on a publicly reachable instance (see
// src/graph/gate.ts), plus Neo4j's own RBAC and plugin configuration.

const WRITE_THROUGH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\bapoc\.cypher\.(runWrite|doIt)\b/i,
    label: "apoc.cypher.runWrite / apoc.cypher.doIt",
  },
  {
    pattern: /\bapoc\.periodic\.(iterate|commit|submit|countdown|repeat)\b/i,
    label: "apoc.periodic.*",
  },
  {
    pattern: /\bapoc\.(create|merge|refactor)\.[a-z]\w*/i,
    label: "apoc.create.* / apoc.merge.* / apoc.refactor.*",
  },
  { pattern: /\bapoc\.nodes\.delete\b/i, label: "apoc.nodes.delete" },
  {
    pattern: /\bapoc\.(load|import|export)\.[a-z]\w*/i,
    label: "apoc.load.* / apoc.import.* / apoc.export.*",
  },
  { pattern: /\bapoc\.trigger\.[a-z]\w*/i, label: "apoc.trigger.*" },
  { pattern: /\bload\s+csv\b/i, label: "LOAD CSV" },
];

/**
 * The forms of the query to test. All of them, not one: each normalisation
 * closes a way of hiding a call and could open another.
 *
 * - The raw text. Comments used to be stripped first, but the stripper knows
 *   nothing of string literals, so a `'//'` inside a string swallowed the rest
 *   of the line -- call included. Testing the raw text as well means a
 *   commented-out call is refused too, which is a harmless false positive.
 * - Comments removed, so `apoc.load/* x *\/.json` cannot split a name.
 * - Backticks removed and whitespace around dots closed up, so
 *   `` `apoc`.`load`.`json` `` and `apoc . load . json` read as what they are.
 */
function candidates(query: string): string[] {
  const noComments = query.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const canonical = (text: string) => text.replace(/`/g, "").replace(/\s*\.\s*/g, ".");
  return [query, noComments, canonical(query), canonical(noComments)];
}

export class WriteThroughRejected extends Error {
  constructor(public readonly matchedLabel: string) {
    super(
      `Query rejected: ${matchedLabel} can bypass READ-mode sessions and write to, or load data from, outside the graph. This server blocks it. If you have a legitimate need, run the query outside this server against a read replica.`
    );
    this.name = "WriteThroughRejected";
  }
}

export function rejectWriteThroughCalls(query: string): void {
  const forms = candidates(query);
  for (const { pattern, label } of WRITE_THROUGH_PATTERNS) {
    if (forms.some(form => pattern.test(form))) {
      throw new WriteThroughRejected(label);
    }
  }
}
