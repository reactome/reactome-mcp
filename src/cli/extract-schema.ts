import { rename, rm, writeFile } from "node:fs/promises";
import { closeDriver } from "../clients/neo4j.js";
import { fetchGraphSchema } from "../graph/schema.js";

/**
 * `reactome-mcp extract-schema` -- write a database's graph schema to JSON.
 *
 *     reactome-mcp extract-schema --uri bolt://127.0.0.1:7687 [--database NAME]
 *       [--user USER] [--password-env VAR] [--out FILE]
 *
 * It runs the server's own extractor, `fetchGraphSchema()`, so a saved schema
 * has exactly the structure the server builds live, `source` fingerprint
 * included; there is no second implementation to drift from the first. The
 * output is what `NEO4J_SCHEMA_FILE` reads.
 *
 * **Not an instance, so not behind MCP_ALLOW_CYPHER.** That switch is consent
 * to *publish* query access. This runs once, by hand, against a database the
 * operator names on the command line, and serves nothing -- it imports no
 * server, tool, resource or transport, which `tests/graph-access-gate.test.ts`
 * checks. It opens the gate for its own process only, after its arguments are
 * read, and connects through the same gated driver, so it runs the same READ
 * sessions under the same timeouts as the server.
 *
 * **No password argument.** A command line is visible to every user of the
 * machine (`ps`), so the password comes from NEO4J_PASSWORD, or from the
 * variable `--password-env` names, and `--password` is refused.
 *
 * A schema with unavailable sections is not written: a saved schema is served
 * for as long as its database matches, so a gap in it would never be filled.
 *
 * Returns the exit code: 0 written, 1 extraction or write failed, 2 usage.
 */

const USAGE = `Usage: reactome-mcp extract-schema --uri <bolt-uri> [options]

Write the graph schema of a Neo4j database as JSON, in the form the server's
NEO4J_SCHEMA_FILE reads. Read-only. Does not need MCP_ALLOW_CYPHER.

  --uri <uri>           the database, e.g. bolt://127.0.0.1:7687 (required)
  --database <name>     database name (default: NEO4J_DATABASE, else the server default)
  --user <name>         user (default: NEO4J_USER, else neo4j)
  --password-env <VAR>  read the password from environment variable VAR
                        (default: NEO4J_PASSWORD; unset connects without credentials)
  --out <file>          write here instead of stdout
  --help                show this

There is no --password: a password on the command line is visible in \`ps\`.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const processIo: CliIo = {
  stdout: text => void process.stdout.write(text),
  stderr: text => void process.stderr.write(text),
};

const VALUE_FLAGS = ["--uri", "--database", "--user", "--password-env", "--out"] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

class UsageError extends Error {}

function parse(args: string[]): { help: boolean; values: Partial<Record<ValueFlag, string>> } {
  const values: Partial<Record<ValueFlag, string>> = {};
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    // Refused by name and never echoed: the value is the secret.
    if (arg === "-p" || arg === "--password" || arg.startsWith("--password=")) {
      throw new UsageError(
        "a password is not accepted on the command line, where `ps` shows it to every " +
          "user of the machine. Put it in the environment: NEO4J_PASSWORD, or the " +
          "variable named by --password-env."
      );
    }
    const eq = arg.indexOf("=");
    const flag = (eq > 0 ? arg.slice(0, eq) : arg) as ValueFlag;
    if (!VALUE_FLAGS.includes(flag)) throw new UsageError(`unknown argument: ${arg}`);
    const value = eq > 0 ? arg.slice(eq + 1) : args[++i];
    if (value === undefined || value === "" || (eq < 0 && value.startsWith("--"))) {
      throw new UsageError(`${flag} needs a value`);
    }
    values[flag] = value;
  }
  return { help, values };
}

export async function runExtractSchema(args: string[], io: CliIo = processIo): Promise<number> {
  let values: Partial<Record<ValueFlag, string>>;
  try {
    const parsed = parse(args);
    if (parsed.help) {
      io.stdout(USAGE);
      return 0;
    }
    values = parsed.values;
    if (!values["--uri"]) throw new UsageError("--uri is required");
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`extract-schema: ${error.message}\n\n${USAGE}`);
    return 2;
  }

  const passwordVar = values["--password-env"];
  let password = process.env.NEO4J_PASSWORD;
  if (passwordVar) {
    password = process.env[passwordVar];
    if (!password) {
      // Connecting without credentials instead would hide the typo.
      io.stderr(`extract-schema: --password-env names ${passwordVar}, which is not set\n`);
      return 2;
    }
  }

  // This process only, and only now that the arguments are known good.
  process.env.NEO4J_URI = values["--uri"];
  process.env.MCP_ALLOW_CYPHER = "1";
  // Always extract: an inherited snapshot would be copied, not regenerated.
  delete process.env.NEO4J_SCHEMA_FILE;
  if (values["--database"]) process.env.NEO4J_DATABASE = values["--database"];
  if (values["--user"]) process.env.NEO4J_USER = values["--user"];
  if (password === undefined) delete process.env.NEO4J_PASSWORD;
  else process.env.NEO4J_PASSWORD = password;

  const out = values["--out"];
  const partial = out ? `${out}.${process.pid}.partial` : undefined;
  try {
    const schema = await fetchGraphSchema();
    if (schema.unavailable.length > 0) {
      io.stderr(
        "extract-schema: not written; these sections could not be read:\n" +
          schema.unavailable.map(u => `  ${u.section}: ${u.reason}\n`).join("")
      );
      return 1;
    }

    const json = JSON.stringify(schema, null, 2) + "\n";
    if (out && partial) {
      // Written aside and renamed, so a failed run never leaves a truncated
      // file where a good one is expected.
      await writeFile(partial, json);
      await rename(partial, out);
      const s = schema.source;
      io.stderr(
        `extract-schema: wrote ${out} (release ${s?.releaseNumber ?? "none"}, ` +
          `${s?.nodeCount ?? "?"} nodes, ${s?.relCount ?? "?"} relationships)\n`
      );
    } else {
      io.stdout(json);
    }
    return 0;
  } catch (error) {
    if (partial) await rm(partial, { force: true });
    io.stderr(`extract-schema: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    await closeDriver();
  }
}
