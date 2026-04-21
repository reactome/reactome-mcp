// Guard against APOC procedures that bypass a READ-mode session.
//
// Neo4j's session access mode (READ) rejects native write clauses
// (CREATE/MERGE/DELETE/SET/REMOVE). But some APOC procedures — which are
// loaded in the reactome_neo4j_env image — open their own transactions and
// can write, load remote URLs, or touch the filesystem regardless of the
// calling session mode. Explicitly block the well-known offenders here.
//
// This is a guardrail, not a security boundary. A determined user can hide
// intent (string concatenation, dynamic CALL, obfuscation) and a real trust
// boundary has to live at the Neo4j RBAC / plugin-config layer. For the
// curator-facing use case this check is sufficient to prevent accidents.

const WRITE_THROUGH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bapoc\.cypher\.(runWrite|doIt)\b/i, label: "apoc.cypher.runWrite / apoc.cypher.doIt" },
  { pattern: /\bapoc\.periodic\.(iterate|commit|submit|countdown|repeat)\b/i, label: "apoc.periodic.*" },
  { pattern: /\bapoc\.(create|merge|refactor)\.[a-z]\w*/i, label: "apoc.create.* / apoc.merge.* / apoc.refactor.*" },
  { pattern: /\bapoc\.nodes\.delete\b/i, label: "apoc.nodes.delete" },
  { pattern: /\bapoc\.(load|import|export)\.[a-z]\w*/i, label: "apoc.load.* / apoc.import.* / apoc.export.*" },
  { pattern: /\bapoc\.trigger\.[a-z]\w*/i, label: "apoc.trigger.*" },
];

function stripComments(query: string): string {
  // // line comments, then /* */ block comments
  return query
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

export class WriteThroughRejected extends Error {
  constructor(public readonly matchedLabel: string) {
    super(
      `Query rejected: calls to ${matchedLabel} can bypass READ-mode sessions and write to or load data from outside the graph. This MCP blocks those procedures. If you have a legitimate need, run the query outside this server against a read replica.`
    );
    this.name = "WriteThroughRejected";
  }
}

export function rejectWriteThroughCalls(query: string): void {
  const cleaned = stripComments(query);
  for (const { pattern, label } of WRITE_THROUGH_PATTERNS) {
    if (pattern.test(cleaned)) {
      throw new WriteThroughRejected(label);
    }
  }
}
