export interface AnalysisResult {
  token: string;
  summary: AnalysisSummary;
  pathways: PathwaySummary[];
  resourceSummary: ResourceSummary[];
  expression?: ExpressionSummary;
  identifiersNotFound?: number;
  pathwaysFound: number;
  warnings?: string[];
}

import { AnalysisType } from "./enums";

export interface AnalysisSummary {
  token: string;
  type: AnalysisType;
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

export interface MappedEntity {
  resource: string;
  identifier: string;
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
