export const ANALYSIS_TYPES = [
  "OVERREPRESENTATION",
  "EXPRESSION",
  "SPECIES_COMPARISON",
] as const;

export type AnalysisType = typeof ANALYSIS_TYPES[number];