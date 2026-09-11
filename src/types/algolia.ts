/** Registro completo de cobertura, como indexado no Algolia. */
export interface CoverageRecord {
  objectID: string;
  id_convenio: number;
  nome_convenio: string;
  id_plano: number;
  nome_plano: string;
  id_unidade: number;
  nome_unidade: string;
  cidade_unidade: string;
  bairro_unidade: string;
  servicos: string[];
}

/**
 * Hit devolvido pelo Algolia. Como usamos `attributesToRetrieve` por
 * `return_type`, todo atributo alem de `objectID` pode estar ausente.
 */
export type AlgoliaHit = Partial<CoverageRecord> & { objectID: string };

export interface AlgoliaSearchParams {
  query?: string;
  filters?: string;
  facets?: string[];
  restrictSearchableAttributes?: string[];
  attributesToRetrieve?: string[];
  hitsPerPage?: number;
}

export interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
  processingTimeMS: number;
  facets?: Record<string, Record<string, number>>;
}

export type AlgoliaSearchFn = (params: AlgoliaSearchParams) => Promise<AlgoliaResponse>;
