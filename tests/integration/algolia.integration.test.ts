import { beforeAll, describe, expect, it } from "vitest";
import { createAlgoliaClient } from "../../src/services/algolia-client.js";
import { createSearchService } from "../../src/services/search-service.js";
import { searchRequestSchema } from "../../src/schemas/search.schema.js";
import type { SearchService } from "../../src/services/search-service.js";
import type { PlanoItem, RecordItem, UnidadeItem } from "../../src/types/api.js";

/**
 * Testes de integracao contra o Algolia REAL.
 *
 * Opt-in explicito: so rodam com RUN_INTEGRATION=1 e as credenciais no
 * ambiente. `npm test` continua offline por padrao.
 *
 *   RUN_INTEGRATION=1 ALGOLIA_APP_ID=... ALGOLIA_SEARCH_API_KEY=... \
 *   ALGOLIA_INDEX_NAME=... npm test
 *
 * As assercoes sao agnosticas ao dataset: validam o schema do indice e a
 * coerencia das relacoes usando IDs descobertos na propria execucao.
 */
const enabled =
  process.env["RUN_INTEGRATION"] === "1" &&
  Boolean(process.env["ALGOLIA_APP_ID"]) &&
  Boolean(process.env["ALGOLIA_SEARCH_API_KEY"]) &&
  Boolean(process.env["ALGOLIA_INDEX_NAME"]);

describe.skipIf(!enabled)("integracao: indice Algolia real", () => {
  let service: SearchService;
  let amostra: RecordItem;

  beforeAll(async () => {
    service = createSearchService(
      createAlgoliaClient({
        appId: process.env["ALGOLIA_APP_ID"] ?? "",
        apiKey: process.env["ALGOLIA_SEARCH_API_KEY"] ?? "",
        indexName: process.env["ALGOLIA_INDEX_NAME"] ?? "",
        timeoutMs: Number(process.env["ALGOLIA_TIMEOUT_MS"] ?? 8000),
      }),
    );

    const { response } = await service.search(
      searchRequestSchema.parse({ return_type: "records", limit: 1 }),
    );
    amostra = response.items[0] as RecordItem;
  });

  it("os registros seguem o schema de cobertura esperado", () => {
    expect(amostra).toMatchObject({
      id_convenio: expect.any(Number),
      nome_convenio: expect.any(String),
      id_plano: expect.any(Number),
      nome_plano: expect.any(String),
      id_unidade: expect.any(Number),
      nome_unidade: expect.any(String),
    });
    expect(Array.isArray(amostra.servicos)).toBe(true);
  });

  it("busca textual pelo nome do plano resolve o mesmo id_plano", async () => {
    const { response } = await service.search(
      searchRequestSchema.parse({
        query: amostra.nome_plano,
        search_scope: "plano",
        return_type: "planos",
        limit: 20,
      }),
    );

    expect((response.items as PlanoItem[]).map((item) => item.id)).toContain(amostra.id_plano);
  });

  it("id_plano lista unidades deduplicadas por ID", async () => {
    const { response } = await service.search(
      searchRequestSchema.parse({ id_plano: amostra.id_plano, return_type: "unidades", limit: 100 }),
    );

    const ids = (response.items as UnidadeItem[]).map((item) => item.id);
    expect(ids).toContain(amostra.id_unidade);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("id_unidade lista planos deduplicados por ID", async () => {
    const { response } = await service.search(
      searchRequestSchema.parse({ id_unidade: amostra.id_unidade, return_type: "planos", limit: 100 }),
    );

    const ids = (response.items as PlanoItem[]).map((item) => item.id);
    expect(ids).toContain(amostra.id_plano);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("servicos da relacao plano + unidade batem com o registro", async () => {
    const { response } = await service.search(
      searchRequestSchema.parse({
        id_plano: amostra.id_plano,
        id_unidade: amostra.id_unidade,
        return_type: "servicos",
      }),
    );

    for (const servico of amostra.servicos) {
      expect(response.items).toContain(servico);
    }
  });

  it("servico existente encontra o registro e servico inexistente devolve vazio", async () => {
    const servico = amostra.servicos[0];
    if (servico === undefined) return;

    const existente = await service.search(
      searchRequestSchema.parse({
        id_plano: amostra.id_plano,
        id_unidade: amostra.id_unidade,
        servico,
        return_type: "records",
      }),
    );
    const inexistente = await service.search(
      searchRequestSchema.parse({
        id_plano: amostra.id_plano,
        id_unidade: amostra.id_unidade,
        servico: "servico-que-nao-existe-no-indice",
        return_type: "records",
      }),
    );

    expect(existente.response.count).toBeGreaterThan(0);
    expect(inexistente.response).toMatchObject({ success: true, count: 0, items: [] });
  });

  it("filtro geografico devolve apenas unidades da cidade", async () => {
    const { response } = await service.search(
      searchRequestSchema.parse({
        cidade: amostra.cidade,
        return_type: "unidades",
        limit: 100,
      }),
    );

    expect(response.count).toBeGreaterThan(0);
    for (const unidade of response.items as UnidadeItem[]) {
      expect(unidade.cidade).toBe(amostra.cidade);
    }
  });
});
