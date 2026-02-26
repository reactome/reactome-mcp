export interface Species {
  dbId: number;
  taxId: string;
  displayName: string;
  name: string;
  shortName?: string;
}

export interface DatabaseInfo {
  name: string;
  version: number;
}

export interface Pathway {
  dbId: number;
  stId: string;
  displayName: string;
  name: string;
  speciesName?: string;
  releaseDate?: string;
  schemaClass: string;
  isInDisease?: boolean;
  isInferred?: boolean;
  hasDiagram?: boolean;
}

export interface Event extends Pathway {
  summation?: Array<{ text: string }>;
  literatureReference?: Array<{
    dbId: number;
    displayName: string;
    pubMedIdentifier?: number;
  }>;
}

export interface PhysicalEntity {
  dbId: number;
  stId: string;
  displayName: string;
  name: string[];
  schemaClass: string;
  speciesName?: string;
  referenceType?: string;
}

export interface Complex extends PhysicalEntity {
  hasComponent?: PhysicalEntity[];
}

export interface SearchResult {
  results: SearchGroup[];
  facets?: Record<string, FacetEntry[]>;
}

export interface SearchGroup {
  typeName: string;
  entriesCount: number;
  rowCount: number;
  entries: SearchEntry[];
}

export interface SearchEntry {
  dbId: string;
  stId: string;
  id?: string;
  name: string;
  type: string;
  exactType: string;
  species: string[];
  summation?: string;
  referenceIdentifier?: string;
  referenceName?: string;
  referenceURL?: string;
  compartmentNames?: string[];
  isDisease?: boolean;
  hasReferenceEntity?: boolean;
}

export interface FacetEntry {
  name: string;
  count: number;
}

export interface Disease {
  dbId: number;
  displayName: string;
  name: string;
  databaseName?: string;
  identifier?: string;
}

export interface Person {
  dbId: number;
  displayName: string;
  firstname?: string;
  surname?: string;
  orcidId?: string;
}

export interface Interactor {
  accession: string;
  alias?: string;
  score: number;
  interactorId?: number;
}

export interface InteractionResult {
  accession: string;
  count: number;
  entities: Interactor[];
}

export interface MappingResult {
  identifier: string;
  pathways: Pathway[];
  reactions?: Event[];
}

export interface ReferenceEntity {
  dbId: number;
  displayName: string;
  identifier: string;
  databaseName: string;
  url?: string;
}
