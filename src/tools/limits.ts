import { z } from "zod";
import { MAX_ANALYSIS_IDENTIFIERS } from "../config.js";

/**
 * Bounds on how much a caller may send *in*.
 *
 * `installToolWrapper` already caps what a call returns, and says why it does
 * so in one place: "a per-tool guard is a guard somebody forgets to add to the
 * fifty-seventh". Nothing capped the other direction:
 * `reactome_analyze_identifiers` took `z.array(nonEmptyString)` with no
 * maximum and posted `identifiers.join("\n")` to the Analysis Service.
 *
 * I first justified this as an unbounded amplification. Over HTTP that was
 * overstated — express's 100 KiB default already bounded it, by accident
 * rather than by anyone's decision. Over stdio nothing bounded it at all.
 * `MAX_ANALYSIS_IDENTIFIERS` says what the cap actually buys.
 *
 * An input cap cannot be applied centrally the way the output cap is, because
 * only the caller knows what a sane length is for a given argument. What can
 * be central is the *requirement*: `tests/input-bounds.test.ts` drives every
 * registered tool, in every configuration, and fails on any argument that
 * accepts an absurd array — so the fifty-seventh tool cannot quietly
 * reintroduce this.
 */

/**
 * A required list argument: non-empty, with an explicit ceiling.
 *
 * `.min(1)` belongs only on the lists that become a request body. An empty
 * identifier list POSTed an empty body and asked the Analysis Service to
 * enrich nothing.
 */
export function boundedList(max: number, describe: string) {
  return z.array(z.string().min(1)).min(1).max(max).describe(`${describe} (at most ${max})`);
}

/**
 * An optional filter list: the same ceiling, but `[]` stays legal.
 *
 * These were `z.array(...).optional()` before, so a client sending `[]` to
 * mean "no filter" worked. Adding `.min(1)` here would have bounded nothing
 * and turned that into a validation error -- a new way to fail with no harm
 * prevented. The ceiling is the point; the floor was not.
 */
export function optionalList(max: number, describe: string) {
  return z.array(z.string().min(1)).max(max).describe(`${describe} (at most ${max})`).optional();
}

/** Identifier lists posted to the Analysis Service. Configurable: a real
 *  enrichment can be large, and the right ceiling depends on the deployment. */
export const identifierList = (describe: string) => boundedList(MAX_ANALYSIS_IDENTIFIERS, describe);

/**
 * A deliberately pessimistic size for a `tools/call` carrying `count`
 * identifiers, in bytes.
 *
 * Used to warn at startup when a configured cap cannot fit through the HTTP
 * transport. It must never *under*-state the real body, or the warning is
 * worse than none; `tests/body-limit.test.ts` asserts it stays at or above a
 * real serialised request, so the margin cannot silently erode.
 *
 * 20 characters is longer than a gene symbol or a UniProt accession and
 * longer than an Ensembl gene ID (15). 5 bytes per element covers the quotes,
 * comma and JSON whitespace; 256 covers the JSON-RPC envelope.
 */
export function estimateAnalysisBodyBytes(count: number, identifierLength = 20): number {
  return 256 + count * (identifierLength + 5);
}
