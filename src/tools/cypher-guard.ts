// What a `reactome_cypher_query` may ask the database to do.
//
// Neo4j's READ access mode refuses native writes. It does not refuse
// everything that reaches outside the graph or costs the server: procedures
// can read server configuration, kill other queries or sleep; LOAD CSV is a
// read clause and fetches URLs; USE switches database, the system database
// included; SHOW lists transactions, users and procedures.
//
// So this is an allowlist, applied to the query as Neo4j will read it. One
// left-to-right scan splits the text into tokens the way the Cypher lexer
// does -- string literals, backtick-quoted names, line and block comments,
// identifiers, numbers, punctuation -- and the rules are checked on those
// tokens. Separate regex passes over the raw text did not compose: a `/*`
// inside a `//` comment or a string literal made one pass see a block comment
// that Neo4j does not, and hide the text after it.
//
// Rules:
//   - CALL only for the built-in schema procedures below, compared by name
//     after backticks are removed; no CALL subqueries.
//   - SHOW only for indexes and constraints.
//   - No name in the apoc or gds namespaces, however it is quoted.
//   - No LOAD CSV, TERMINATE, PERIODIC COMMIT, START/STOP DATABASE, no USE
//     where a query part begins, and no write or administration keyword
//     (CREATE, MERGE, SET, DELETE, REMOVE, DETACH, DROP, GRANT, DENY, REVOKE,
//     ALTER, RENAME). SET and SHOW are refused even as variable names: they
//     can begin a clause in too many places to tell apart safely.
//   - A number literal with a name running straight on from it is refused.
//   - Text the scanner cannot finish reading -- an unterminated string,
//     comment or quoted name -- is refused.
//
// It is a guardrail, not the security boundary, and it errs towards refusing.
// The boundary is that graph access is never enabled on a publicly reachable
// instance (src/graph/gate.ts), plus Neo4j's own configuration.

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
  // READ-mode procedures in Neo4j 4.3/4.4: they query an existing fulltext
  // index. Creating and dropping one are separate procedures, not listed.
  "db.index.fulltext.querynodes",
  "db.index.fulltext.queryrelationships",
]);

/**
 * Plugin namespaces. Any name in them is refused, called or not: their
 * procedures and functions are not part of what a read needs, and several
 * write, load from outside the graph, or run other queries.
 */
const PLUGIN_NAMESPACES = ["apoc", "gds"];

/** Keywords refused wherever they appear as a keyword. */
const FORBIDDEN_KEYWORDS = new Set([
  "terminate",
  "periodic",
  "create",
  "merge",
  "set",
  "delete",
  "remove",
  "detach",
  "drop",
  "grant",
  "deny",
  "revoke",
  "alter",
  "rename",
]);

/** Words that may sit between SHOW and INDEXES / CONSTRAINTS. */
const SHOW_MODIFIERS = new Set([
  "all",
  "btree",
  "fulltext",
  "lookup",
  "text",
  "range",
  "point",
  "vector",
  "unique",
  "uniqueness",
  "existence",
  "exist",
  "exists",
  "node",
  "relationship",
  "rel",
  "key",
  "property",
]);
const SHOW_TARGETS = new Set(["index", "indexes", "constraint", "constraints"]);

export class QueryRejected extends Error {
  constructor(public readonly reason: string) {
    super(
      `Query rejected: ${reason}. This server runs read-only queries against the graph and allows ` +
        `CALL only for ${[...ALLOWED_PROCEDURES].join(", ")} (no CALL subqueries), ` +
        `and SHOW only for indexes and constraints.`
    );
    this.name = "QueryRejected";
  }
}

type Token =
  | { kind: "word"; text: string } // an unquoted identifier or keyword
  | { kind: "quoted"; text: string } // a backtick-quoted name, unquoted
  | { kind: "string" } // a string literal; its contents are not kept
  | { kind: "number" }
  | { kind: "punct"; text: string };

const DIGIT = /[0-9]/;
const IDENTIFIER_START = /[\p{ID_Start}_]/u;
const IDENTIFIER_PART = /[\p{ID_Continue}_]/u;

/**
 * Whitespace as Cypher reads it, and then some: everything Unicode calls
 * white space, every control and format character (U+001C-U+001F included),
 * and NEL. Treating more as a separator than Neo4j does can only split a
 * token the guard then refuses; treating less could join two.
 */
const SEPARATOR = /[\p{White_Space}\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}]/u;

/** Split a query into tokens. Throws QueryRejected on text it cannot finish. */
export function tokenize(query: string): Token[] {
  // Line separators other than LF and CR, anywhere -- inside a comment or a
  // string included. Where a `//` comment ends at one of these is exactly the
  // kind of disagreement with the Cypher lexer that hides text, so a query
  // containing one is refused rather than guessed at.
  if (/[\u0085\u2028\u2029]/u.test(query)) {
    throw new QueryRejected("the query contains a Unicode line separator");
  }

  const tokens: Token[] = [];
  const chars = [...query]; // by code point, so astral characters stay whole
  let i = 0;

  const unterminated = (what: string) => {
    throw new QueryRejected(`unterminated ${what}`);
  };

  while (i < chars.length) {
    const c = chars[i] as string;
    const next = chars[i + 1];

    if (SEPARATOR.test(c)) {
      i++;
      continue;
    }

    // Line comment: to the end of the line.
    if (c === "/" && next === "/") {
      i += 2;
      while (i < chars.length && chars[i] !== "\n" && chars[i] !== "\r") i++;
      continue;
    }

    // Block comment: to the first */. Nothing inside it means anything.
    if (c === "/" && next === "*") {
      i += 2;
      while (i < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) i++;
      if (i >= chars.length) unterminated("comment");
      i += 2;
      continue;
    }

    // String literal, single or double quoted, with backslash escapes.
    if (c === "'" || c === '"') {
      i++;
      while (i < chars.length && chars[i] !== c) i += chars[i] === "\\" ? 2 : 1;
      if (i >= chars.length) unterminated("string literal");
      i++;
      tokens.push({ kind: "string" });
      continue;
    }

    // Backtick-quoted name; a doubled backtick is a literal one.
    if (c === "`") {
      let text = "";
      i++;
      for (;;) {
        if (i >= chars.length) unterminated("quoted name");
        if (chars[i] === "`") {
          if (chars[i + 1] === "`") {
            text += "`";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        text += chars[i];
        i++;
      }
      tokens.push({ kind: "quoted", text });
      continue;
    }

    // A number literal, read the way Cypher defines one: decimal with an
    // optional fraction and exponent (`1`, `1.5`, `.5`, `1e3`, `1.5E-3`),
    // hexadecimal `0x1F`, octal `0o17` (or `017`, which the decimal rule
    // covers). A name running straight on from one -- `1e0CALL`, `0x1LOAD`,
    // `1_000` -- is refused rather than guessed at: where the lexer splits
    // that is exactly what decides whether a keyword is seen.
    if (DIGIT.test(c) || (c === "." && DIGIT.test(next ?? ""))) {
      const at = (k: number) => chars[k] ?? "";
      if (c === "0" && /[xX]/.test(at(i + 1))) {
        i += 2;
        while (/[0-9a-fA-F]/.test(at(i))) i++;
      } else if (c === "0" && /[oO]/.test(at(i + 1))) {
        i += 2;
        while (/[0-7]/.test(at(i))) i++;
      } else {
        while (DIGIT.test(at(i))) i++;
        if (at(i) === "." && DIGIT.test(at(i + 1))) {
          i++;
          while (DIGIT.test(at(i))) i++;
        }
        const signed = /[+-]/.test(at(i + 1));
        if (/[eE]/.test(at(i)) && DIGIT.test(at(i + (signed ? 2 : 1)))) {
          i += signed ? 2 : 1;
          while (DIGIT.test(at(i))) i++;
        }
      }
      if (IDENTIFIER_PART.test(at(i)) || at(i) === "`") {
        throw new QueryRejected("a name runs straight on from a number literal");
      }
      tokens.push({ kind: "number" });
      continue;
    }

    if (IDENTIFIER_START.test(c)) {
      let text = "";
      while (i < chars.length && IDENTIFIER_PART.test(chars[i] as string)) {
        text += chars[i];
        i++;
      }
      tokens.push({ kind: "word", text });
      continue;
    }

    tokens.push({ kind: "punct", text: c });
    i++;
  }

  return tokens;
}

const isName = (t: Token | undefined): t is Extract<Token, { kind: "word" | "quoted" }> =>
  t?.kind === "word" || t?.kind === "quoted";
const isPunct = (t: Token | undefined, text: string) => t?.kind === "punct" && t.text === text;
const lower = (t: Token | undefined) => (isName(t) ? t.text.toLowerCase() : undefined);

/**
 * Whether the word at `i` is used as a keyword rather than as a name: not a
 * property or label (`n.set`, `:Create`), a parameter (`$use`) or a map key
 * (`{delete: 1}`).
 */
function isKeyword(tokens: Token[], i: number): boolean {
  if (tokens[i]?.kind !== "word") return false;
  const before = tokens[i - 1];
  if (isPunct(before, ".") || isPunct(before, ":") || isPunct(before, "$")) return false;
  if (isPunct(tokens[i + 1], ":")) return false;
  return true;
}

/**
 * Whether token `i` is where a query part begins: the start of the text, or
 * after EXPLAIN / PROFILE, UNION [ALL], `;` or `{`.
 */
function beginsQueryPart(tokens: Token[], i: number): boolean {
  const before = tokens[i - 1];
  if (before === undefined) return true;
  if (isPunct(before, ";") || isPunct(before, "{")) return true;
  const word = before.kind === "word" ? before.text.toLowerCase() : undefined;
  if (word === "explain" || word === "profile" || word === "union") return true;
  return word === "all" && lower(tokens[i - 2]) === "union";
}

function check(tokens: Token[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const word = lower(token);
    if (word === undefined) continue;

    // Any plugin name, procedure or function, however it is quoted:
    // apoc.x(...), `apoc`.x(...) and `apoc.x`(...) are the same call.
    for (const ns of PLUGIN_NAMESPACES) {
      if (
        (word === ns && isPunct(tokens[i + 1], ".")) ||
        (token?.kind === "quoted" && word.startsWith(`${ns}.`))
      ) {
        return `${ns.toUpperCase()} procedures and functions are not allowed`;
      }
    }

    if (!isKeyword(tokens, i)) continue;

    if (word === "load" && lower(tokens[i + 1]) === "csv") return "LOAD CSV is not allowed";
    // Administration only when followed by DATABASE; otherwise start and
    // stop are ordinary names, common in path queries.
    if ((word === "start" || word === "stop") && lower(tokens[i + 1]) === "database") {
      return `${word.toUpperCase()} DATABASE is not allowed`;
    }
    // USE is a clause only where a query, a UNION part or a subquery begins;
    // anywhere else `use` is a name.
    if (word === "use" && beginsQueryPart(tokens, i)) return "USE is not allowed";
    if (FORBIDDEN_KEYWORDS.has(word)) return `${word.toUpperCase()} is not allowed`;

    if (word === "show") {
      let j = i + 1;
      while (SHOW_MODIFIERS.has(lower(tokens[j]) ?? "")) j++;
      if (!SHOW_TARGETS.has(lower(tokens[j]) ?? "")) {
        return "SHOW is allowed only for indexes and constraints";
      }
    }

    if (word === "call") {
      const parts: string[] = [];
      let j = i + 1;
      while (isName(tokens[j])) {
        parts.push((tokens[j] as { text: string }).text.toLowerCase());
        if (!isPunct(tokens[j + 1], ".")) break;
        j += 2;
      }
      if (parts.length === 0) return "CALL subqueries are not allowed";
      const name = parts.join(".");
      if (!ALLOWED_PROCEDURES.has(name)) return `CALL ${name} is not allowed`;
    }
  }
  return undefined;
}

/** Throw `QueryRejected` unless the query passes every rule. */
export function assertReadOnlyQuery(query: string): void {
  const reason = check(tokenize(query));
  if (reason) throw new QueryRejected(reason);
}
