import { contentClient } from "./clients/content.js";

export interface CitationVerificationResult {
  final_answer: string;
  valid_ids: string[];
  invalid_ids: string[];
}

export interface ContextEntry {
  statement: string;
  id: string;
}

/**
 * Extract Reactome IDs from text using regex pattern R-HSA-\d+
 */
function extractReactomeIds(text: string): string[] {
  const pattern = /R-HSA-\d+/g;
  const matches = text.match(pattern);
  return matches ? [...new Set(matches)] : []; // Remove duplicates
}

/**
 * Validate a Reactome ID by querying the API
 */
async function validateReactomeId(id: string): Promise<boolean> {
  try {
    await contentClient.get(`/data/query/enhanced/${encodeURIComponent(id)}`);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Parse context string into statement-ID pairs
 * Assumes context format like: "statement [R-HSA-XXXXX]"
 */
function parseContext(context: string): ContextEntry[] {
  const entries: ContextEntry[] = [];
  // Split by newlines or other delimiters if multiple entries
  const lines = context.split('\n').filter(line => line.trim());

  for (const line of lines) {
    // Match patterns like "statement [R-HSA-XXXXX]" or "statement → something [R-HSA-XXXXX]"
    const match = line.match(/^(.+?)\s*\[(R-HSA-\d+)\]$/);
    if (match) {
      entries.push({
        statement: match[1].trim(),
        id: match[2].trim()
      });
    }
  }

  return entries;
}

/**
 * Find the best matching Reactome ID for a statement from context
 */
function findMatchingId(statement: string, contextEntries: ContextEntry[]): string | null {
  // Simple matching: check if statement contains key parts of context entries
  for (const entry of contextEntries) {
    // Normalize for comparison
    const stmtLower = statement.toLowerCase();
    const entryLower = entry.statement.toLowerCase();

    // Check if statement contains the context statement or vice versa
    if (stmtLower.includes(entryLower) || entryLower.includes(stmtLower)) {
      return entry.id;
    }

    // Check for key biological terms (simple heuristic)
    const stmtWords = stmtLower.split(/\s+/);
    const entryWords = entryLower.split(/\s+/);
    const commonWords = stmtWords.filter(word => entryWords.includes(word) && word.length > 3);
    if (commonWords.length >= 2) { // At least 2 common significant words
      return entry.id;
    }
  }

  return null;
}

/**
 * Process the answer to add citations where missing
 */
function injectCitations(answer: string, contextEntries: ContextEntry[]): string {
  const sentences = answer.split(/[.!?]+/).filter(s => s.trim());

  const processedSentences: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Check if sentence already has Reactome ID
    if (extractReactomeIds(trimmed).length > 0) {
      processedSentences.push(trimmed);
    } else {
      // Try to find matching ID from context
      const matchingId = findMatchingId(trimmed, contextEntries);
      if (matchingId) {
        processedSentences.push(`${trimmed} [${matchingId}]`);
      } else {
        processedSentences.push(`${trimmed} [No validated Reactome reference found]`);
      }
    }
  }

  return processedSentences.join('. ') + (processedSentences.length > 0 ? '.' : '');
}

/**
 * Main function to verify citations and ensure all biological claims are grounded
 */
export async function verifyCitations(
  answer: string,
  context: string
): Promise<CitationVerificationResult> {
  // Extract all Reactome IDs from the answer
  const extractedIds = extractReactomeIds(answer);

  // Validate each ID
  const validationPromises = extractedIds.map(async (id) => ({
    id,
    isValid: await validateReactomeId(id)
  }));

  const validationResults = await Promise.all(validationPromises);

  const validIds = validationResults.filter(r => r.isValid).map(r => r.id);
  const invalidIds = validationResults.filter(r => !r.isValid).map(r => r.id);

  // Parse context for citation injection
  const contextEntries = parseContext(context);

  // Inject citations into answer where missing
  const finalAnswer = injectCitations(answer, contextEntries);

  return {
    final_answer: finalAnswer,
    valid_ids: validIds,
    invalid_ids: invalidIds
  };
}