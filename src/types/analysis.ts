export interface AnalysisResult {
  /**
   * The Analysis Service does NOT return a top-level token -- it is on
   * `summary.token`. This field was declared here and read by the formatter,
   * which printed "**Token:** undefined" and left reactome_get_analysis_result
   * and reactome_analysis_found_entities unreachable, since both require a
   * token from a previous analysis.
   */
  token?: string;
  summary: AnalysisSummary;
  /** Per-species pathway counts. The only place species information appears. */
  speciesSummary?: SpeciesSummary[];
  pathways: PathwaySummary[];
  resourceSummary: ResourceSummary[];
  expression?: ExpressionSummary;
  identifiersNotFound?: number;
  pathwaysFound: number;
  warnings?: string[];
}

export interface AnalysisSummary {
  token: string;
  type: "OVERREPRESENTATION" | "EXPRESSION" | "SPECIES_COMPARISON";
  sampleName?: string;
  species: number;
  speciesName?: string;
  text: boolean;
  projection?: boolean;
  interactors: boolean;
  includeDisease: boolean;
}

export interface PathwaySummary {
  stId: string;
  dbId: number;
  name: string;
  species: SpeciesNode;
  llp: boolean;
  entities: EntityStatistics;
  reactions: ReactionStatistics;
}

export interface SpeciesNode {
  dbId: number;
  taxId: string;
  name: string;
}

export interface EntityStatistics {
  resource: string;
  total: number;
  found: number;
  ratio: number;
  pValue: number;
  fdr: number;
  exp?: number[];
}

export interface ReactionStatistics {
  resource: string;
  total: number;
  found: number;
  ratio: number;
}

export interface ResourceSummary {
  resource: string;
  pathways: number;
}

export interface ExpressionSummary {
  columnNames: string[];
  min: number;
  max: number;
}

export interface FoundElements {
  pathway: string;
  entities: FoundEntity[];
  interactors?: FoundInteractor[];
  foundEntities: number;
  foundInteractors: number;
}

export interface FoundEntity {
  id: string;
  mapsTo: MappedEntity[];
  exp?: number[];
}

/**
 * A mapsTo entry groups the resource identifiers one submitted id resolved to.
 * Verified against the live Analysis Service:
 *
 *   GET /token/{token}/found/all/{pathway}
 *   {"id": "TP53", "exp": [], "mapsTo": [{"resource": "UNIPROT", "ids": ["P04637"]}]}
 *
 * There is no singular `identifier` -- reading it rendered "TP53 -> undefined".
 */
export interface MappedEntity {
  resource: string;
  ids: string[];
}

export interface FoundInteractor {
  id: string;
  mapsTo: MappedInteractor[];
}

export interface MappedInteractor {
  resource: string;
  identifier: string;
  interactsWith: InteractsWith[];
}

export interface InteractsWith {
  id: string;
  accession: string;
}

export interface IdentifierSummary {
  id: string;
  exp?: number[];
}

export interface SpeciesComparisonResult {
  token: string;
  pathways: PathwaySummary[];
  pathwaysFound: number;
}

export interface Bin {
  key: number;
  value: number;
}

export interface FilteredResult {
  pathways: PathwaySummary[];
  pathwaysFiltered: number;
}

export interface SpeciesSummary {
  dbId: number;
  taxId: string;
  name: string;
  pathways: number;
  filtered: number;
}
