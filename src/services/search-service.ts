import type { SearchRequest } from "../schemas/search.schema.js";
import type { AlgoliaSearchFn, AlgoliaSearchParams } from "../types/algolia.js";
import type { SearchItem, SearchSuccessResponse } from "../types/api.js";
import { buildFilters, countFilters } from "../search/filter-builder.js";
import { buildRestrictSearchableAttributes } from "../search/scope-builder.js";
import {
  attributesToRetrieveFor,
  dedupeConvenios,
  dedupePlanos,
  dedupeUnidades,
  extractServicosFromFacets,
  extractServicosFromHits,
  toRecordItems,
} from "../search/normalizers.js";

/** Teto do Algolia para `hitsPerPage`. */
const ALGOLIA_MAX_HITS_PER_PAGE = 1000;
/** Piso de hits lidos quando a resposta e agregada (dedupe por ID). */
const AGGREGATION_MIN_HITS = 200;

export interface SearchServiceResult {
  response: SearchSuccessResponse;
  /** Dados para log — nao trafegam na resposta HTTP. */
  diagnostics: {
    nb_hits: number;
    algolia_ms: number;
    filter_count: number;
    used_query: boolean;
  };
}

export interface SearchService {
  search(request: SearchRequest): Promise<SearchServiceResult>;
}

/**
 * Para `records` o `limit` vale direto. Para respostas agregadas precisamos ler
 * mais hits do que o limite final, porque varios hits colapsam num unico item
 * apos a deduplicacao por ID.
 */
function hitsPerPageFor(request: SearchRequest): number {
  if (request.return_type === "records") return request.limit;
  return Math.min(ALGOLIA_MAX_HITS_PER_PAGE, Math.max(request.limit * 10, AGGREGATION_MIN_HITS));
}

function buildItems(
  request: SearchRequest,
  hits: Parameters<typeof toRecordItems>[0],
  facets: Record<string, Record<string, number>> | undefined,
): SearchItem[] {
  switch (request.return_type) {
    case "records":
      return toRecordItems(hits);
    case "convenios":
      return dedupeConvenios(hits);
    case "planos":
      return dedupePlanos(hits);
    case "unidades":
      return dedupeUnidades(hits);
    case "servicos": {
      // Facet e a fonte preferida; hits sao o fallback quando `servicos` nao
      // esta declarado como attributeForFaceting no indice.
      const fromFacets = extractServicosFromFacets(facets);
      return fromFacets.length > 0 ? fromFacets : extractServicosFromHits(hits);
    }
  }
}

/**
 * Orquestra request -> filtros -> scope -> Algolia -> normalizacao -> response.
 * Nenhuma dessas etapas vive na rota.
 */
export function createSearchService(searchAlgolia: AlgoliaSearchFn): SearchService {
  return {
    async search(request: SearchRequest): Promise<SearchServiceResult> {
      const filterInput = {
        id_convenio: request.id_convenio,
        id_plano: request.id_plano,
        id_unidade: request.id_unidade,
        servico: request.servico,
        cidade: request.cidade,
        bairro: request.bairro,
      };

      const filters = buildFilters(filterInput);
      // `restrictSearchableAttributes` so faz sentido com busca textual.
      const restrictSearchableAttributes =
        request.query === undefined
          ? undefined
          : buildRestrictSearchableAttributes(request.search_scope);

      const params: AlgoliaSearchParams = {
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(filters === undefined ? {} : { filters }),
        ...(restrictSearchableAttributes === undefined ? {} : { restrictSearchableAttributes }),
        ...(request.return_type === "servicos" ? { facets: ["servicos"] } : {}),
        attributesToRetrieve: attributesToRetrieveFor(request.return_type),
        hitsPerPage: hitsPerPageFor(request),
      };

      const result = await searchAlgolia(params);
      const items = buildItems(request, result.hits, result.facets).slice(0, request.limit);

      return {
        response: {
          success: true,
          return_type: request.return_type,
          count: items.length,
          items,
          meta: {
            nb_hits: result.nbHits,
            processing_time_ms: result.processingTimeMS,
          },
        },
        diagnostics: {
          nb_hits: result.nbHits,
          algolia_ms: result.processingTimeMS,
          filter_count: countFilters(filterInput),
          used_query: request.query !== undefined,
        },
      };
    },
  };
}
