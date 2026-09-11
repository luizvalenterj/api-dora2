import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createSearchService } from "../src/services/search-service.js";
import { createFakeAlgolia } from "./helpers/fake-algolia.js";

const API_KEY = "test-access-key";
let app: FastifyInstance | undefined;

function makeApp(apiAccessKey: string | undefined): FastifyInstance {
  app = buildApp({
    searchService: createSearchService(createFakeAlgolia().search),
    apiAccessKey,
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const BODY = { id_plano: 1001, return_type: "unidades" } as const;

describe("autenticacao Bearer", () => {
  it("aceita o Bearer correto", async () => {
    const response = await makeApp(API_KEY).inject({
      method: "POST",
      url: "/v1/search",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: BODY,
    });

    expect(response.statusCode).toBe(200);
  });

  it("recusa Bearer incorreto", async () => {
    const response = await makeApp(API_KEY).inject({
      method: "POST",
      url: "/v1/search",
      headers: { authorization: "Bearer chave-errada" },
      payload: BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("recusa requisicao sem header Authorization", async () => {
    const response = await makeApp(API_KEY).inject({
      method: "POST",
      url: "/v1/search",
      payload: BODY,
    });

    expect(response.statusCode).toBe(401);
  });

  it("recusa esquema diferente de Bearer", async () => {
    const response = await makeApp(API_KEY).inject({
      method: "POST",
      url: "/v1/search",
      headers: { authorization: `Basic ${API_KEY}` },
      payload: BODY,
    });

    expect(response.statusCode).toBe(401);
  });

  it("mantem /health e / publicos", async () => {
    const instance = makeApp(API_KEY);

    expect((await instance.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await instance.inject({ method: "GET", url: "/" })).statusCode).toBe(200);
  });

  it("desliga a autenticacao quando API_ACCESS_KEY nao esta configurada", async () => {
    const response = await makeApp(undefined).inject({
      method: "POST",
      url: "/v1/search",
      payload: BODY,
    });

    expect(response.statusCode).toBe(200);
  });
});
