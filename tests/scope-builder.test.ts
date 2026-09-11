import { describe, expect, it } from "vitest";
import { buildRestrictSearchableAttributes } from "../src/search/scope-builder.js";

describe("buildRestrictSearchableAttributes", () => {
  it("mapeia plano para nome_plano", () => {
    expect(buildRestrictSearchableAttributes("plano")).toEqual(["nome_plano"]);
  });

  it("mapeia convenio e unidade", () => {
    expect(buildRestrictSearchableAttributes("convenio")).toEqual(["nome_convenio"]);
    expect(buildRestrictSearchableAttributes("unidade")).toEqual(["nome_unidade"]);
  });

  it("mapeia localizacao para cidade e bairro", () => {
    expect(buildRestrictSearchableAttributes("localizacao")).toEqual([
      "cidade_unidade",
      "bairro_unidade",
    ]);
  });

  it("nao restringe quando o scope e all", () => {
    expect(buildRestrictSearchableAttributes("all")).toBeUndefined();
  });
});
