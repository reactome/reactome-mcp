// What a `reactome_cypher_query` may ask the database to do.
//
// Neo4j's READ access mode refuses native writes (CREATE/MERGE/DELETE/SET/
// REMOVE). It does not refuse everything that reaches outside the graph or
// costs the server: procedures can open their own transactions, read server
// configuration, kill other queries or sleep; LOAD CSV is a read clause and
// fetches URLs; USE switches database, the system database included; SHOW
// lists transactions, users and procedures.
//
// So this is an allowlist, not a list of known offenders. A query may CALL
// only the read-only built-ins the schema tooling itself uses, may SHOW only
// indexes and constraints, and may not name APOC, use LOAD CSV, USE or
// TERMINATE at all.
//
// It is a guardrail, not the security boundary. A pattern cannot fully parse
// Cypher, and it errs towards refusing -- a string literal containing
// "apoc." is refused too. The boundary is that graph access is never enabled
// on a publicly reachable instance (src/graph/gate.ts), plus Neo4j's own
// configuration.

/** Procedures a query may CALL, lower-cased. Everything else is refused. */
const ALLOWED_PROCEDURES = new Set([
  "db.labels",
  "db.relationshiptypes",
  "db.propertykeys",
  "db.schema.nodetypeproperties",
  "db.schema.reltypeproperties",
  "db.schema.visualization",
  "db.indexes",
  "db.constraints",
  "dbms.components",
]);

export class QueryRejected extends Error {
  constructor(public readonly reason: string) {
    super(
      `Query rejected: ${reason}. This server runs read-only queries against the graph and allows ` +
        `CALL only for ${[...ALLOWED_PROCEDURES].join(", ")}, and SHOW only for indexes and constraints.`
    );
    this.name = "QueryRejected";
  }
}

/**
 * The forms of the query to check. All of them, because each normalisation
 * closes one way of hiding a token and could open another:
 *
 * - the raw text -- a comment stripper knows nothing of string literals, so a
 *   `'//'` inside a string would otherwise swallow the rest of its line;
 * - comments replaced by a **space** -- a comment separates tokens, so
 *   `LOAD/**\/CSV` is `LOAD CSV` (deleting it made `LOADCSV`, which matched
 *   nothing);
 * - each of those with backticks removed and whitespace around dots closed
 *   up, so `` `dbms`.`listConfig` `` and `dbms . listConfig` read as one name.
 */
function forms(query: string): string[] {
  const spaced = query.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const canonical = (text: string) => text.replace(/`/g, "").replace(/\s*\.\s*/g, ".");
  return [query, spaced, canonical(query), canonical(spaced)];
}

// A keyword at a token boundary: not part of a longer name, and not a
// property access like `n.use`.
const keyword = (word: string) => new RegExp(`(?<![\\w.$])${word}(?![\\w])`, "i");

const SHOW_ALLOWED =
  /^\s*(?:all\s+|btree\s+|fulltext\s+|lookup\s+|text\s+|range\s+|point\s+|unique\s+|existence\s+|node\s+|relationship\s+|rel\s+|key\s+|exists\s+|property\s+)*(?:index|indexes|constraint|constraints)\b/i;

function check(form: string): string | undefined {
  if (/(?<![\w$])apoc\./i.test(form)) return "APOC procedures and functions are not allowed";
  if (new RegExp(`${keyword("load").source}\\s+csv\\b`, "i").test(form)) {
    return "LOAD CSV is not allowed";
  }
  if (new RegExp(`${keyword("use").source}\\s+[\\w\`]`, "i").test(form)) {
    return "USE is not allowed";
  }
  if (keyword("terminate").test(form)) return "TERMINATE is not allowed";

  for (const match of form.matchAll(new RegExp(`${keyword("show").source}`, "gi"))) {
    const rest = form.slice((match.index ?? 0) + match[0].length);
    if (!SHOW_ALLOWED.test(rest)) return "SHOW is allowed only for indexes and constraints";
  }

  for (const match of form.matchAll(new RegExp(`${keyword("call").source}`, "gi"))) {
    const rest = form.slice((match.index ?? 0) + match[0].length);
    // CALL { ... } is a subquery, not a procedure.
    if (/^\s*\{/.test(rest)) continue;
    const name = /^\s*([A-Za-z_][\w.]*)/.exec(rest)?.[1]?.toLowerCase();
    if (!name || !ALLOWED_PROCEDURES.has(name)) {
      return `CALL ${name ?? "(unrecognised target)"} is not allowed`;
    }
  }
  return undefined;
}

/** Throw `QueryRejected` unless every form of the query passes. */
export function assertReadOnlyQuery(query: string): void {
  for (const form of forms(query)) {
    const reason = check(form);
    if (reason) throw new QueryRejected(reason);
  }
}
