import { describe, expect, it } from "vitest";
import { createSearchService } from "../src/services/search-service.js";
import { searchRequestSchema, type SearchRequestInput } from "../src/schemas/search.schema.js";
import { createFakeAlgolia } from "./helpers/fake-algolia.js";
import type { PlanoItem, UnidadeItem } from "../src/types/api.js";

function parse(input: SearchRequestInput) {
  return searchRequestSchema.parse(input);
}

describe("search-service", () => {
  it("A — resolve um plano por busca textual restrita ao nome_plano", async () => {
    const algolia = createFakeAlgolia();
    const service = createSearchService(algolia.search);

    const { response } = await service.search(
      parse({ query: "Bradesco Nacional Flex", search_scope: "plano", return_type: "planos" }),
    );

    expect(algolia.calls[0]?.restrictSearchableAttributes).toEqual(["nome_plano"]);
    expect(response.items).toEqual<PlanoItem[]>([
      { id: 1001, nome: "Bradesco Nacional Flex", id_convenio: 101, nome_convenio: "Bradesco" },
    ]);
    expect(response.count).toBe(1);
  });

  it("B — lista unidades distintas de um plano", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(parse({ id_plano: 1001, return_type: "unidades" }));

    expect((response.items as UnidadeItem[]).map((item) => item.id)).toEqual([201, 202, 301]);
  });

  it("C — lista servicos da relacao plano + unidade", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(
      parse({ id_plano: 1001, id_unidade: 201, return_type: "servicos" }),
    );

    expect(response.items).toEqual(["consultas"]);
  });

  it("D — emergencia inexistente devolve lista vazia, sem mensagem semantica", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(
      parse({ id_plano: 1001, id_unidade: 201, servico: "emergencia", return_type: "records" }),
    );

    expect(response).toMatchObject({ success: true, return_type: "records", count: 0, items: [] });
    expect(JSON.stringify(response)).not.toMatch(/cobre|cobertura/i);
  });

  it("E — consultas existentes devolvem o registro de cobertura", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(
      parse({ id_plano: 1001, id_unidade: 201, servico: "consultas", return_type: "records" }),
    );

    expect(response.count).toBe(1);
    expect(response.items[0]).toMatchObject({
      id_plano: 1001,
      id_unidade: 201,
      nome_unidade: "São Luiz Morumbi",
      servicos: ["consultas"],
    });
  });

  it("F — unidades com exames para o plano", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(
      parse({ id_plano: 1001, servico: "exames", return_type: "unidades" }),
    );

    expect((response.items as UnidadeItem[]).map((item) => item.nome)).toEqual([
      "São Luiz Itaim",
      "Copa D'Or",
    ]);
  });

  it("G — planos aceitos numa unidade, deduplicados por ID", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(parse({ id_unidade: 201, return_type: "planos" }));

    expect((response.items as PlanoItem[]).map((item) => item.id)).toEqual([1001, 1020]);
  });

  it("H — filtro geografico por cidade", async () => {
    const algolia = createFakeAlgolia();
    const service = createSearchService(algolia.search);

    const { response } = await service.search(
      parse({ id_plano: 1001, cidade: "Rio de Janeiro", return_type: "unidades" }),
    );

    expect(algolia.calls[0]?.filters).toBe('id_plano:1001 AND cidade_unidade:"Rio de Janeiro"');
    expect((response.items as UnidadeItem[]).map((item) => item.id)).toEqual([301]);
  });

  it("filtra por bairro", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(
      parse({ id_plano: 1001, bairro: "Copacabana", return_type: "unidades" }),
    );

    expect((response.items as UnidadeItem[]).map((item) => item.id)).toEqual([301]);
  });

  it("lista convenios distintos de uma unidade", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(parse({ id_unidade: 301, return_type: "convenios" }));

    expect(response.items).toEqual([
      { id: 101, nome: "Bradesco" },
      { id: 103, nome: "Unimed" },
    ]);
  });

  it("devolve todas as entidades plausiveis em caso de ambiguidade", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(
      parse({ query: "Flex", search_scope: "plano", return_type: "planos" }),
    );

    expect((response.items as PlanoItem[]).map((item) => item.nome)).toEqual([
      "Bradesco Nacional Flex",
      "SulAmérica Nacional Flex",
      "Unimed Flex",
    ]);
  });

  it("pede facet de servicos e atributos minimos por return_type", async () => {
    const algolia = createFakeAlgolia();
    const service = createSearchService(algolia.search);

    await service.search(parse({ id_plano: 1001, id_unidade: 202, return_type: "servicos" }));

    expect(algolia.calls[0]?.facets).toEqual(["servicos"]);
    expect(algolia.calls[0]?.attributesToRetrieve).toEqual(["servicos"]);
  });

  it("nao envia restrictSearchableAttributes quando nao ha query", async () => {
    const algolia = createFakeAlgolia();
    const service = createSearchService(algolia.search);

    await service.search(parse({ id_plano: 1001, search_scope: "plano", return_type: "unidades" }));

    expect(algolia.calls[0]?.restrictSearchableAttributes).toBeUndefined();
    expect(algolia.calls[0]?.query).toBeUndefined();
  });

  it("respeita o limit apos a deduplicacao", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { response } = await service.search(
      parse({ id_plano: 1001, return_type: "unidades", limit: 2 }),
    );

    expect(response.count).toBe(2);
    expect(response.meta.nb_hits).toBe(3);
  });

  it("le mais hits do que o limite quando a resposta e agregada", async () => {
    const algolia = createFakeAlgolia();
    const service = createSearchService(algolia.search);

    await service.search(parse({ id_plano: 1001, return_type: "unidades", limit: 5 }));
    expect(algolia.calls[0]?.hitsPerPage).toBe(200);

    await service.search(parse({ id_plano: 1001, return_type: "records", limit: 5 }));
    expect(algolia.calls[1]?.hitsPerPage).toBe(5);
  });

  it("expoe diagnosticos para log sem alterar o contrato de resposta", async () => {
    const service = createSearchService(createFakeAlgolia().search);

    const { diagnostics, response } = await service.search(
      parse({ id_plano: 1001, id_unidade: 202, servico: "exames", return_type: "records" }),
    );

    expect(diagnostics).toEqual({ nb_hits: 1, algolia_ms: 1, filter_count: 3, used_query: false });
    expect(Object.keys(response)).toEqual(["success", "return_type", "count", "items", "meta"]);
  });
});
