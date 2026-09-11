import { describe, expect, it } from "vitest";
import {
  attributesToRetrieveFor,
  dedupeConvenios,
  dedupePlanos,
  dedupeUnidades,
  extractServicosFromFacets,
  extractServicosFromHits,
} from "../src/search/normalizers.js";
import type { AlgoliaHit } from "../src/types/algolia.js";

function hit(overrides: Partial<AlgoliaHit> & { objectID: string }): AlgoliaHit {
  return overrides;
}

describe("deduplicacao", () => {
  it("colapsa 10 hits do mesmo plano em um unico item", () => {
    const hits = Array.from({ length: 10 }, (_, index) =>
      hit({
        objectID: `101_1001_${index}`,
        id_plano: 1001,
        nome_plano: "Bradesco Nacional Flex",
        id_convenio: 101,
        nome_convenio: "Bradesco",
      }),
    );

    expect(dedupePlanos(hits)).toEqual([
      { id: 1001, nome: "Bradesco Nacional Flex", id_convenio: 101, nome_convenio: "Bradesco" },
    ]);
  });

  it("deduplica por ID mesmo com nomes diferentes", () => {
    const hits = [
      hit({ objectID: "a", id_unidade: 201, nome_unidade: "São Luiz Morumbi", cidade_unidade: "São Paulo", bairro_unidade: "Morumbi" }),
      hit({ objectID: "b", id_unidade: 201, nome_unidade: "Sao Luiz Morumbi", cidade_unidade: "São Paulo", bairro_unidade: "Morumbi" }),
      hit({ objectID: "c", id_unidade: 202, nome_unidade: "São Luiz Itaim", cidade_unidade: "São Paulo", bairro_unidade: "Itaim Bibi" }),
    ];

    expect(dedupeUnidades(hits).map((unidade) => unidade.id)).toEqual([201, 202]);
  });

  it("nao junta convenios homonimos de IDs distintos", () => {
    const hits = [
      hit({ objectID: "a", id_convenio: 101, nome_convenio: "Bradesco" }),
      hit({ objectID: "b", id_convenio: 102, nome_convenio: "Bradesco" }),
    ];

    expect(dedupeConvenios(hits)).toHaveLength(2);
  });

  it("ignora hits sem o ID correspondente", () => {
    expect(dedupePlanos([hit({ objectID: "a", nome_plano: "sem id" })])).toEqual([]);
  });
});

describe("servicos", () => {
  it("extrai servicos distintos dos hits", () => {
    const hits = [
      hit({ objectID: "a", servicos: ["consultas", "exames"] }),
      hit({ objectID: "b", servicos: ["exames", "internacao"] }),
    ];

    expect(extractServicosFromHits(hits)).toEqual(["consultas", "exames", "internacao"]);
  });

  it("le servicos do facet ordenando por contagem", () => {
    expect(
      extractServicosFromFacets({ servicos: { exames: 2, consultas: 9, oncologia: 9 } }),
    ).toEqual(["consultas", "oncologia", "exames"]);
  });

  it("devolve lista vazia quando o facet nao existe", () => {
    expect(extractServicosFromFacets(undefined)).toEqual([]);
    expect(extractServicosFromFacets({ outro: { x: 1 } })).toEqual([]);
  });

  it("aceita servicos fora da lista inicial de quatro", () => {
    expect(extractServicosFromHits([hit({ objectID: "a", servicos: ["oncologia", "uti"] })])).toEqual([
      "oncologia",
      "uti",
    ]);
  });
});

describe("attributesToRetrieveFor", () => {
  it("pede somente o necessario por return_type", () => {
    expect(attributesToRetrieveFor("unidades")).toEqual([
      "id_unidade",
      "nome_unidade",
      "cidade_unidade",
      "bairro_unidade",
    ]);
    expect(attributesToRetrieveFor("servicos")).toEqual(["servicos"]);
    expect(attributesToRetrieveFor("convenios")).toEqual(["id_convenio", "nome_convenio"]);
  });
});
