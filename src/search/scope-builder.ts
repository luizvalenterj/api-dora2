import type { SearchScope } from "../schemas/search.schema.js";

const SCOPE_ATTRIBUTES: Record<SearchScope, readonly string[] | undefined> = {
  all: undefined,
  convenio: ["nome_convenio"],
  plano: ["nome_plano"],
  unidade: ["nome_unidade"],
  localizacao: ["cidade_unidade", "bairro_unidade"],
};

/**
 * Traduz `search_scope` em `restrictSearchableAttributes`.
 * `all` nao restringe e devolve `undefined`.
 */
export function buildRestrictSearchableAttributes(scope: SearchScope): string[] | undefined {
  const attributes = SCOPE_ATTRIBUTES[scope];
  return attributes === undefined ? undefined : [...attributes];
}
