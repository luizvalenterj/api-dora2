import type { AlgoliaHit } from "../types/algolia.js";
import type { ReturnType } from "../schemas/search.schema.js";
import type { ConvenioItem, PlanoItem, RecordItem, UnidadeItem } from "../types/api.js";

/**
 * Atributos pedidos ao Algolia por `return_type`.
 * Reduz payload de rede e evita trafegar dado que o agente nao vai usar.
 */
const ATTRIBUTES_BY_RETURN_TYPE: Record<ReturnType, readonly string[]> = {
  convenios: ["id_convenio", "nome_convenio"],
  planos: ["id_plano", "nome_plano", "id_convenio", "nome_convenio"],
  unidades: ["id_unidade", "nome_unidade", "cidade_unidade", "bairro_unidade"],
  servicos: ["servicos"],
  records: [
    "id_convenio",
    "nome_convenio",
    "id_plano",
    "nome_plano",
    "id_unidade",
    "nome_unidade",
    "cidade_unidade",
    "bairro_unidade",
    "servicos",
  ],
};

export function attributesToRetrieveFor(returnType: ReturnType): string[] {
  return [...ATTRIBUTES_BY_RETURN_TYPE[returnType]];
}

/** Deduplicacao sempre por ID — nunca por nome. */
export function dedupeConvenios(hits: readonly AlgoliaHit[]): ConvenioItem[] {
  const convenios = new Map<number, ConvenioItem>();

  for (const hit of hits) {
    if (typeof hit.id_convenio !== "number" || convenios.has(hit.id_convenio)) continue;
    convenios.set(hit.id_convenio, {
      id: hit.id_convenio,
      nome: hit.nome_convenio ?? "",
    });
  }

  return [...convenios.values()];
}

export function dedupePlanos(hits: readonly AlgoliaHit[]): PlanoItem[] {
  const planos = new Map<number, PlanoItem>();

  for (const hit of hits) {
    if (typeof hit.id_plano !== "number" || planos.has(hit.id_plano)) continue;
    planos.set(hit.id_plano, {
      id: hit.id_plano,
      nome: hit.nome_plano ?? "",
      id_convenio: hit.id_convenio ?? 0,
      nome_convenio: hit.nome_convenio ?? "",
    });
  }

  return [...planos.values()];
}

export function dedupeUnidades(hits: readonly AlgoliaHit[]): UnidadeItem[] {
  const unidades = new Map<number, UnidadeItem>();

  for (const hit of hits) {
    if (typeof hit.id_unidade !== "number" || unidades.has(hit.id_unidade)) continue;
    unidades.set(hit.id_unidade, {
      id: hit.id_unidade,
      nome: hit.nome_unidade ?? "",
      cidade: hit.cidade_unidade ?? "",
      bairro: hit.bairro_unidade ?? "",
    });
  }

  return [...unidades.values()];
}

/** Servicos a partir dos hits (fallback quando o facet nao esta disponivel). */
export function extractServicosFromHits(hits: readonly AlgoliaHit[]): string[] {
  const servicos = new Set<string>();

  for (const hit of hits) {
    if (!Array.isArray(hit.servicos)) continue;
    for (const servico of hit.servicos) {
      if (typeof servico === "string" && servico.trim() !== "") servicos.add(servico);
    }
  }

  return [...servicos];
}

/** Servicos a partir do facet `servicos`, ordenados por contagem desc. */
export function extractServicosFromFacets(
  facets: Record<string, Record<string, number>> | undefined,
): string[] {
  const servicoFacet = facets?.["servicos"];
  if (servicoFacet === undefined) return [];

  return Object.entries(servicoFacet)
    .sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB))
    .map(([name]) => name);
}

/** Mantem o registro de cobertura num formato estavel para o agente. */
export function toRecordItems(hits: readonly AlgoliaHit[]): RecordItem[] {
  return hits.map((hit) => ({
    objectID: hit.objectID,
    id_convenio: hit.id_convenio ?? 0,
    nome_convenio: hit.nome_convenio ?? "",
    id_plano: hit.id_plano ?? 0,
    nome_plano: hit.nome_plano ?? "",
    id_unidade: hit.id_unidade ?? 0,
    nome_unidade: hit.nome_unidade ?? "",
    cidade: hit.cidade_unidade ?? "",
    bairro: hit.bairro_unidade ?? "",
    servicos: Array.isArray(hit.servicos) ? [...hit.servicos] : [],
  }));
}
