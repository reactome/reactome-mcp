import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface QueryUnderstandingResult {
  original_query: string;
  intent: 'explanation' | 'comparison' | 'lookup' | 'disease' | 'mechanism';
  confidence: number;
  sub_queries: string[];
}

export async function understandQuery(query: string): Promise<QueryUnderstandingResult> {
  const prompt = `
You are a biological query understanding system for a RAG chatbot. Your task is to analyze a user query and return a structured JSON response.

First, classify the intent into one of these categories:
- explanation: asking for clarification or description of biological concepts
- comparison: comparing different biological entities, processes, or conditions
- lookup: searching for specific information like names, IDs, or basic facts
- disease: queries related to diseases, their causes, symptoms, or treatments
- mechanism: asking about how biological processes work at a molecular or cellular level

Then, determine if the query is complex or multi-part. If it is, break it into smaller, independent sub-queries that:
- Are self-contained
- Can retrieve relevant biological information independently
- Preserve the original intent
- Avoid redundancy

For simple queries, return a single sub-query that is the query itself.

Output must be valid JSON in this exact format:
{
  "original_query": "<user query>",
  "intent": "<classified intent>",
  "confidence": <0 to 1>,
  "sub_queries": [
    "<sub-query 1>",
    "<sub-query 2>",
    ...
  ]
}

Be robust to simple, complex, and ambiguous queries.

Query: "${query}"
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini', // or gpt-3.5-turbo for cost
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1, // low for consistency
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from LLM');
  }

  try {
    const result: QueryUnderstandingResult = JSON.parse(content.trim());
    // Validate the structure
    if (
      typeof result.original_query === 'string' &&
      ['explanation', 'comparison', 'lookup', 'disease', 'mechanism'].includes(result.intent) &&
      typeof result.confidence === 'number' &&
      result.confidence >= 0 && result.confidence <= 1 &&
      Array.isArray(result.sub_queries) &&
      result.sub_queries.every(q => typeof q === 'string')
    ) {
      return result;
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (error) {
    throw new Error(`Failed to parse LLM response: ${error}`);
  }
}