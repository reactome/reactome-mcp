import { z } from "zod";

/**
 * Every free-text argument this server accepts: search terms, stable IDs,
 * species filters, analysis tokens.
 *
 * Blank and whitespace-only values are rejected here rather than forwarded.
 * An empty `q` reaches the Content Service as either an error or a request for
 * everything, and an empty token produces a 404 that reads like the analysis
 * expired. Failing at the schema gives the model a message it can act on.
 *
 * The 2048 cap is a guard against a model pasting a document into an argument.
 *
 * The shared-schema idea, and the trim/min(1) validation, are from #5 by
 * @adidev001.
 */
export const nonEmptyString = z.string().trim().min(1).max(2048);
