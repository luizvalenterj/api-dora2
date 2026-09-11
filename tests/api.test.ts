import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createSearchService } from "../src/services/search-service.js";
import { createFakeAlgolia } from "./helpers/fake-algolia.js";
import { AppError } from "../src/errors/app-error.js";
import type { AlgoliaSearchFn } from "../src/types/algolia.js";

const API_KEY = "test-access-key";
const AUTH = { authorization: `Bearer ${API_KEY}` };

let app: FastifyInstance;
let algolia: ReturnType<typeof createFakeAlgolia>;

function buildWith(search: AlgoliaSearchFn): FastifyInstance {
  return buildApp({ searchService: createSearchService(search), apiAccessKey: API_KEY });
}

beforeEach(() => {
  algolia = createFakeAlgolia();
  app = buildWith(algolia.search);
});

afterEach(async () => {
  await app.close();
});

describe("rotas publicas", () => {
  it("GET / identifica o servico", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "health-network-api", status: "ok" });
  });

  it("GET /health responde 200 sem consultar o Algolia", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "healthy" });
    expect(algolia.calls).toHaveLength(0);
  });

  it("rota inexistente devolve 404 padronizado", async () => {
    const response = await app.inject({ method: "GET", url: "/nao-existe", headers: AUTH });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });
});

describe("POST /v1/search", () => {
  it("resolve plano por busca textual", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { query: "Bradesco Nacional Flex", search_scope: "plano", return_type: "planos" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      return_type: "planos",
      count: 1,
      items: [
        { id: 1001, nome: "Bradesco Nacional Flex", id_convenio: 101, nome_convenio: "Bradesco" },
      ],
      // 3 hits (uma linha por unidade) colapsam num unico plano apos dedupe.
      meta: { nb_hits: 3, processing_time_ms: 1 },
    });
  });

  it("valida o body com Zod e devolve 422", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { return_type: "inexistente" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(response.json().request_id).toEqual(expect.any(String));
  });

  it("exige return_type", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { id_plano: 1001 },
    });

    expect(response.statusCode).toBe(422);
  });

  it("recusa filtros Algolia arbitrarios vindos do cliente", async () => {
    for (const payload of [
      { return_type: "unidades", filters: "id_plano:9999" },
      { return_type: "unidades", facets: ["servicos"] },
      { return_type: "unidades", restrictSearchableAttributes: ["nome_plano"] },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/search",
        headers: AUTH,
        payload,
      });

      expect(response.statusCode).toBe(422);
      expect(algolia.calls).toHaveLength(0);
    }
  });

  it("recusa limit fora da faixa e id nao positivo", async () => {
    const tooLarge = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { return_type: "unidades", limit: 500 },
    });
    const negativeId = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { return_type: "unidades", id_plano: -1 },
    });

    expect(tooLarge.statusCode).toBe(422);
    expect(negativeId.statusCode).toBe(422);
  });

  it("devolve 400 para JSON malformado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: { ...AUTH, "content-type": "application/json" },
      payload: "{ invalido",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, error: { code: "BAD_REQUEST" } });
  });

  it("ausencia de cobertura devolve count 0 sem interpretacao semantica", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { id_plano: 1001, id_unidade: 201, servico: "emergencia", return_type: "records" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      return_type: "records",
      count: 0,
      items: [],
    });
  });

  it("propaga erro do Algolia como 502 sem vazar credenciais", async () => {
    await app.close();
    const failing: AlgoliaSearchFn = vi.fn(async () => {
      throw AppError.algolia("Algolia responded with HTTP 403 for app SECRETAPP.");
    });
    app = buildWith(failing);

    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { id_plano: 1001, return_type: "unidades" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "ALGOLIA_ERROR", message: "Unable to query search provider." },
    });
    expect(response.body).not.toContain("SECRETAPP");
    expect(response.body).not.toContain("403");
  });

  it("timeout do Algolia vira 504", async () => {
    await app.close();
    const timingOut: AlgoliaSearchFn = vi.fn(async () => {
      throw AppError.algoliaTimeout();
    });
    app = buildWith(timingOut);

    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { id_plano: 1001, return_type: "unidades" },
    });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ error: { code: "ALGOLIA_TIMEOUT" } });
  });

  it("erro inesperado vira 500 generico, sem stack trace", async () => {
    await app.close();
    const broken: AlgoliaSearchFn = vi.fn(async () => {
      throw new Error("boom at /src/services/algolia-client.ts:42");
    });
    app = buildWith(broken);

    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: AUTH,
      payload: { id_plano: 1001, return_type: "unidades" },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Internal server error." },
    });
    expect(response.body).not.toContain("boom");
  });

  it("cada requisicao recebe um request_id unico", async () => {
    const first = await app.inject({ method: "GET", url: "/nao-existe", headers: AUTH });
    const second = await app.inject({ method: "GET", url: "/nao-existe", headers: AUTH });

    expect(first.json().request_id).not.toBe(second.json().request_id);
  });
});
