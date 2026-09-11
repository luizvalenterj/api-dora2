import { AppError } from "../errors/app-error.js";

export interface FilterInput {
  id_convenio?: number | undefined;
  id_plano?: number | undefined;
  id_unidade?: number | undefined;
  servico?: string | undefined;
  cidade?: string | undefined;
  bairro?: string | undefined;
}

/**
 * Escapa um valor usado dentro de aspas duplas numa expressao de filtro.
 * Valores como `Copa D'Or`, `São Luiz` e `Barra da Tijuca` passam intactos;
 * aspas duplas e barras invertidas sao neutralizadas.
 */
export function escapeAlgoliaFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function numericClause(attribute: string, value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw AppError.validation({ field: attribute, message: "must be a safe integer" });
  }
  return `${attribute}:${value}`;
}

function facetClause(attribute: string, value: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw AppError.validation({ field: attribute, message: "must not be empty" });
  }
  return `${attribute}:"${escapeAlgoliaFilterValue(normalized)}"`;
}

/**
 * Converte campos tipados do request na expressao `filters` do Algolia.
 * Toda a construcao de filtros vive aqui: rotas e servicos nao concatenam
 * string de filtro em nenhum outro ponto do projeto.
 */
export function buildFilters(input: FilterInput): string | undefined {
  const clauses: string[] = [];

  if (input.id_convenio !== undefined) clauses.push(numericClause("id_convenio", input.id_convenio));
  if (input.id_plano !== undefined) clauses.push(numericClause("id_plano", input.id_plano));
  if (input.id_unidade !== undefined) clauses.push(numericClause("id_unidade", input.id_unidade));

  if (input.servico !== undefined) clauses.push(facetClause("servicos", input.servico));
  if (input.cidade !== undefined) clauses.push(facetClause("cidade_unidade", input.cidade));
  if (input.bairro !== undefined) clauses.push(facetClause("bairro_unidade", input.bairro));

  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

/** Quantidade de filtros aplicados — usada apenas em log. */
export function countFilters(input: FilterInput): number {
  return Object.values(input).filter((value) => value !== undefined).length;
}
