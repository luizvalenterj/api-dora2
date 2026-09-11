import { vi } from "vitest";
import type {
  AlgoliaHit,
  AlgoliaResponse,
  AlgoliaSearchFn,
  AlgoliaSearchParams,
  CoverageRecord,
} from "../../src/types/algolia.js";

/**
 * Dataset sintetico usado nos testes.
 * Bradesco Nacional Flex (1001) no São Luiz Morumbi (201) possui apenas
 * `consultas` — nao possui `emergencia`. No São Luiz Itaim (202) possui os
 * quatro servicos.
 */
export const DATASET: CoverageRecord[] = [
  {
    objectID: "101_1001_201",
    id_convenio: 101,
    nome_convenio: "Bradesco",
    id_plano: 1001,
    nome_plano: "Bradesco Nacional Flex",
    id_unidade: 201,
    nome_unidade: "São Luiz Morumbi",
    cidade_unidade: "São Paulo",
    bairro_unidade: "Morumbi",
    servicos: ["consultas"],
  },
  {
    objectID: "101_1001_202",
    id_convenio: 101,
    nome_convenio: "Bradesco",
    id_plano: 1001,
    nome_plano: "Bradesco Nacional Flex",
    id_unidade: 202,
    nome_unidade: "São Luiz Itaim",
    cidade_unidade: "São Paulo",
    bairro_unidade: "Itaim Bibi",
    servicos: ["consultas", "exames", "emergencia", "internacao"],
  },
  {
    objectID: "101_1001_301",
    id_convenio: 101,
    nome_convenio: "Bradesco",
    id_plano: 1001,
    nome_plano: "Bradesco Nacional Flex",
    id_unidade: 301,
    nome_unidade: "Copa D'Or",
    cidade_unidade: "Rio de Janeiro",
    bairro_unidade: "Copacabana",
    servicos: ["consultas", "exames", "emergencia"],
  },
  {
    objectID: "102_1020_201",
    id_convenio: 102,
    nome_convenio: "SulAmérica",
    id_plano: 1020,
    nome_plano: "SulAmérica Nacional Flex",
    id_unidade: 201,
    nome_unidade: "São Luiz Morumbi",
    cidade_unidade: "São Paulo",
    bairro_unidade: "Morumbi",
    servicos: ["consultas", "exames", "emergencia", "internacao"],
  },
  {
    objectID: "103_1040_301",
    id_convenio: 103,
    nome_convenio: "Unimed",
    id_plano: 1040,
    nome_plano: "Unimed Flex",
    id_unidade: 301,
    nome_unidade: "Copa D'Or",
    cidade_unidade: "Rio de Janeiro",
    bairro_unidade: "Copacabana",
    servicos: ["consultas"],
  },
];

interface Clause {
  attribute: string;
  value: string | number;
}

/** Interpreta o subconjunto de sintaxe que o filter-builder produz. */
function parseFilters(filters: string | undefined): Clause[] {
  if (filters === undefined) return [];

  return filters.split(" AND ").map((rawClause) => {
    const separator = rawClause.indexOf(":");
    const attribute = rawClause.slice(0, separator);
    const rawValue = rawClause.slice(separator + 1);

    if (rawValue.startsWith('"')) {
      const unquoted = rawValue.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      return { attribute, value: unquoted };
    }

    return { attribute, value: Number(rawValue) };
  });
}

function matches(record: CoverageRecord, clauses: Clause[]): boolean {
  return clauses.every((clause) => {
    const field = record[clause.attribute as keyof CoverageRecord];
    if (Array.isArray(field)) return field.includes(String(clause.value));
    return field === clause.value;
  });
}

function matchesQuery(
  record: CoverageRecord,
  query: string | undefined,
  restrict: string[] | undefined,
): boolean {
  if (query === undefined || query.trim() === "") return true;

  const searchable = restrict ?? [
    "nome_plano",
    "nome_convenio",
    "nome_unidade",
    "cidade_unidade",
    "bairro_unidade",
  ];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  return searchable.some((attribute) => {
    const value = record[attribute as keyof CoverageRecord];
    if (typeof value !== "string") return false;
    const haystack = value.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

function project(record: CoverageRecord, attributes: string[] | undefined): AlgoliaHit {
  if (attributes === undefined) return { ...record };

  const hit: AlgoliaHit = { objectID: record.objectID };
  for (const attribute of attributes) {
    const value = record[attribute as keyof CoverageRecord];
    if (value !== undefined) {
      Object.assign(hit, { [attribute]: value });
    }
  }
  return hit;
}

/**
 * Algolia falso e deterministico: avalia filtros e busca textual sobre
 * `DATASET`. Testes unitarios nunca tocam a rede.
 */
export function createFakeAlgolia(records: CoverageRecord[] = DATASET) {
  const calls: AlgoliaSearchParams[] = [];

  const search: AlgoliaSearchFn = vi.fn(async (params: AlgoliaSearchParams): Promise<AlgoliaResponse> => {
    calls.push(params);

    const clauses = parseFilters(params.filters);
    const matched = records.filter(
      (record) =>
        matches(record, clauses) &&
        matchesQuery(record, params.query, params.restrictSearchableAttributes),
    );

    const hits = matched
      .slice(0, params.hitsPerPage ?? 20)
      .map((record) => project(record, params.attributesToRetrieve));

    const response: AlgoliaResponse = {
      hits,
      nbHits: matched.length,
      processingTimeMS: 1,
    };

    if (params.facets?.includes("servicos")) {
      const counters: Record<string, number> = {};
      for (const record of matched) {
        for (const servico of record.servicos) {
          counters[servico] = (counters[servico] ?? 0) + 1;
        }
      }
      response.facets = { servicos: counters };
    }

    return response;
  });

  return { search, calls };
}
