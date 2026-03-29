import OpenAI from 'openai';
import { contentClient } from './clients/content.js';
import { understandQuery, QueryUnderstandingResult } from './queryUnderstanding.js';
import { verifyCitations, CitationVerificationResult } from './citationVerification.js';
import type { SearchResult, SearchEntry } from './types/index.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface RAGPipelineResult {
  intent: string;
  sub_queries: string[];
  final_answer: string;
  valid_ids: string[];
  invalid_ids: string[];
}

interface MergedSearchEntry extends SearchEntry {
  sourceSubQuery: string;
}

/**
 * Perform search for a single sub-query
 */
async function searchSubQuery(subQuery: string): Promise<SearchEntry[]> {
  try {
    const params: Record<string, string | number | boolean | undefined> = {
      query: subQuery,
      rows: 50, // Get more results for better coverage
      cluster: true,
    };

    const result = await contentClient.get<SearchResult>('/search/query', params);

    // Flatten results
    const entries: SearchEntry[] = [];
    for (const group of result.results) {
      entries.push(...group.entries);
    }

    return entries;
  } catch (error) {
    console.error(`Search failed for sub-query "${subQuery}":`, error);
    return [];
  }
}

/**
 * Merge and deduplicate search results from multiple sub-queries
 */
function mergeAndDeduplicateResults(results: MergedSearchEntry[]): SearchEntry[] {
  const seen = new Set<string>();
  const deduplicated: SearchEntry[] = [];

  for (const entry of results) {
    if (!seen.has(entry.stId)) {
      seen.add(entry.stId);
      deduplicated.push(entry);
    }
  }

  return deduplicated;
}

/**
 * Construct structured context from search results
 */
function constructContext(entries: SearchEntry[]): string {
  const contextLines: string[] = [];

  for (const entry of entries) {
    const name = entry.name.replace(/<[^>]*>/g, ''); // Strip HTML
    const type = entry.exactType;
    const id = entry.stId;

    contextLines.push(`${name} (${type}) [${id}]`);

    if (entry.summation) {
      const summary = entry.summation.replace(/<[^>]*>/g, '');
      contextLines.push(`  Description: ${summary}`);
    }

    if (entry.species && entry.species.length > 0) {
      contextLines.push(`  Species: ${entry.species.join(', ')}`);
    }

    if (entry.referenceIdentifier) {
      const ref = entry.referenceName
        ? `${entry.referenceIdentifier} (${entry.referenceName})`
        : entry.referenceIdentifier;
      contextLines.push(`  Reference: ${ref}`);
    }

    contextLines.push(''); // Empty line between entries
  }

  return contextLines.join('\n');
}

/**
 * Generate answer using LLM with context and citation enforcement
 */
async function generateAnswer(originalQuery: string, context: string): Promise<string> {
  const prompt = `
You are a biological expert answering questions based solely on the provided Reactome context. Your answer must be grounded in the given information and include Reactome IDs for every biological claim.

Context from Reactome:
${context}

User Question: ${originalQuery}

Instructions:
- Answer using ONLY the information in the context above
- For every biological entity, pathway, reaction, or process mentioned, include the Reactome ID in brackets [R-HSA-XXXXX]
- If something is not covered in the context, state that clearly
- Be comprehensive but concise
- Structure your answer logically

Answer:
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1, // Low for factual answers
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from LLM');
  }

  return content.trim();
}

/**
 * Main RAG pipeline function
 */
export async function runRAGPipeline(userQuery: string): Promise<RAGPipelineResult> {
  // Step 1: Query Understanding
  const queryResult: QueryUnderstandingResult = await understandQuery(userQuery);

  // Step 2: Retrieval using sub-queries
  const searchPromises = queryResult.sub_queries.map(async (subQuery) => {
    const entries = await searchSubQuery(subQuery);
    return entries.map(entry => ({ ...entry, sourceSubQuery: subQuery }));
  });

  const searchResults = await Promise.all(searchPromises);
  const allResults = searchResults.flat();

  // Step 3: Merge and deduplicate
  const deduplicatedEntries = mergeAndDeduplicateResults(allResults);

  // Step 4: Construct context
  const context = constructContext(deduplicatedEntries);

  // Step 5: Generate answer with LLM
  const rawAnswer = await generateAnswer(userQuery, context);

  // Step 6: Citation verification
  const verificationResult: CitationVerificationResult = await verifyCitations(rawAnswer, context);

  // Step 7: Return structured result
  return {
    intent: queryResult.intent,
    sub_queries: queryResult.sub_queries,
    final_answer: verificationResult.final_answer,
    valid_ids: verificationResult.valid_ids,
    invalid_ids: verificationResult.invalid_ids,
  };
}