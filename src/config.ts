const DEFAULT_BASE_URL = "https://reactome.org";

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const REACTOME_BASE_URL = normalizeBaseUrl(
  process.env.REACTOME_BASE_URL ?? DEFAULT_BASE_URL
);

export const CONTENT_SERVICE_URL =
  process.env.REACTOME_CONTENT_SERVICE_URL ?? `${REACTOME_BASE_URL}/ContentService/`;
export const ANALYSIS_SERVICE_URL =
  process.env.REACTOME_ANALYSIS_SERVICE_URL ?? `${REACTOME_BASE_URL}/AnalysisService/`;

export const DEFAULT_SPECIES = "Homo sapiens";
export const DEFAULT_PAGE_SIZE = 25;

export const SORT_OPTIONS = [
  "NAME",
  "TOTAL_ENTITIES",
  "TOTAL_INTERACTORS",
  "TOTAL_REACTIONS",
  "FOUND_ENTITIES",
  "FOUND_INTERACTORS",
  "FOUND_REACTIONS",
  "ENTITIES_RATIO",
  "ENTITIES_PVALUE",
  "ENTITIES_FDR",
  "REACTIONS_RATIO",
] as const;

export const RESOURCE_TYPES = [
  "TOTAL",
  "UNIPROT",
  "ENSEMBL",
  "CHEBI",
  "IUPHAR",
  "MIRBASE",
  "NCBI_PROTEIN",
  "EMBL",
  "COMPOUND",
] as const;

export const DIAGRAM_FORMATS = ["png", "jpg", "jpeg", "svg", "gif"] as const;

export const NEO4J_URI = process.env.NEO4J_URI;
export const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "neo4j";
export const NEO4J_DATABASE = process.env.NEO4J_DATABASE ?? "graph.db";
