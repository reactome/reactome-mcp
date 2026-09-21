import { z } from "zod";
import { MAX_ANALYSIS_IDENTIFIERS } from "../config.js";

/**
 * Bounds on how much a caller may send *in*.
 *
 * `installToolWrapper` already caps what a call returns, and says why it does
 * so in one place: "a per-tool guard is a guard somebody forgets to add to the
 * fifty-seventh". Nothing capped the other direction. On a private instance
 * that was academic. Fronted by a public nginx it is not:
 * `reactome_analyze_identifiers` took `z.array(nonEmptyString)` with no
 * maximum and posted `identifiers.join("\n")` to the Analysis Service, so one
 * small MCP call could commission an arbitrarily large analysis job and a
 * stored result — an amplification with no ceiling anywhere in the path.
 *
 * An input cap cannot be applied centrally the way the output cap is, because
 * only the caller knows what a sane length is for a given argument. What can
 * be central is the *requirement*: `tests/input-bounds.test.ts` walks every
 * registered tool schema and fails on any array without a maximum, so the
 * fifty-seventh tool cannot quietly reintroduce this.
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
