import { describe, expect, it } from "vitest";
import { buildFilters, countFilters, escapeAlgoliaFilterValue } from "../src/search/filter-builder.js";
import { AppError } from "../src/errors/app-error.js";

describe("buildFilters", () => {
  it("combina id_plano, id_unidade e servico com AND", () => {
    expect(buildFilters({ id_plano: 1001, id_unidade: 201, servico: "emergencia" })).toBe(
      'id_plano:1001 AND id_unidade:201 AND servicos:"emergencia"',
    );
  });

  it("devolve undefined quando nao ha nenhum filtro", () => {
    expect(buildFilters({})).toBeUndefined();
  });

  it("filtra por convenio isoladamente", () => {
    expect(buildFilters({ id_convenio: 101 })).toBe("id_convenio:101");
  });

  it("aplica filtro geografico por cidade e bairro", () => {
    expect(buildFilters({ id_plano: 1001, cidade: "Rio de Janeiro", bairro: "Barra da Tijuca" })).toBe(
      'id_plano:1001 AND cidade_unidade:"Rio de Janeiro" AND bairro_unidade:"Barra da Tijuca"',
    );
  });

  it("normaliza espacos em volta dos valores", () => {
    expect(buildFilters({ cidade: "  São Paulo  " })).toBe('cidade_unidade:"São Paulo"');
  });

  it("rejeita ID nao inteiro", () => {
    expect(() => buildFilters({ id_plano: 10.5 })).toThrow(AppError);
    expect(() => buildFilters({ id_plano: Number.NaN })).toThrow(AppError);
  });

  it("conta os filtros aplicados", () => {
    expect(countFilters({ id_plano: 1001, id_unidade: 201 })).toBe(2);
    expect(countFilters({ id_plano: 1001, servico: undefined })).toBe(1);
  });
});

describe("escapeAlgoliaFilterValue", () => {
  it("preserva apostrofo e acento", () => {
    expect(escapeAlgoliaFilterValue("Copa D'Or")).toBe("Copa D'Or");
    expect(escapeAlgoliaFilterValue("São Luiz")).toBe("São Luiz");
    expect(escapeAlgoliaFilterValue("Barra da Tijuca")).toBe("Barra da Tijuca");
  });

  it("neutraliza aspas duplas e barra invertida", () => {
    expect(escapeAlgoliaFilterValue('Hospital "X"')).toBe('Hospital \\"X\\"');
    expect(escapeAlgoliaFilterValue("a\\b")).toBe("a\\\\b");
  });

  it("nao permite injetar clausula extra pelo valor", () => {
    const filters = buildFilters({ cidade: 'X" OR servicos:"emergencia' });
    expect(filters).toBe('cidade_unidade:"X\\" OR servicos:\\"emergencia"');
  });
});
