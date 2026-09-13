import { describe, expect, it, vi } from "vitest";
import { createAlgoliaClient } from "../src/services/algolia-client.js";
import { AppError } from "../src/errors/app-error.js";

const CONFIG = {
  appId: "APPID123",
  apiKey: "super-secret-search-key",
  indexName: "rede_credenciada",
  timeoutMs: 50,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createAlgoliaClient", () => {
  it("monta URL, headers e payload da REST API", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ hits: [], nbHits: 0, processingTimeMS: 3 }),
    );
    const client = createAlgoliaClient({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });

    await client({
      query: "Nacional Flex",
      filters: "id_plano:1001",
      restrictSearchableAttributes: ["nome_plano"],
      hitsPerPage: 20,
    });

    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://APPID123.algolia.net/1/indexes/rede_credenciada/query");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "X-Algolia-Application-Id": "APPID123",
      "X-Algolia-API-Key": "super-secret-search-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      query: "Nacional Flex",
      filters: "id_plano:1001",
      restrictSearchableAttributes: ["nome_plano"],
      hitsPerPage: 20,
      attributesToHighlight: [],
      attributesToSnippet: [],
    });
  });

  it("nao anexa dispatcher quando nao ha proxy configurado", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ hits: [], nbHits: 0, processingTimeMS: 1 }));
    const client = createAlgoliaClient({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });

    await client({ query: "x" });

    const call = fetchImpl.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[1]).not.toHaveProperty("dispatcher");
  });

  it("usa um dispatcher de proxy quando proxyUrl esta configurado", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ hits: [], nbHits: 0, processingTimeMS: 1 }));
    const client = createAlgoliaClient({
      ...CONFIG,
      proxyUrl: "http://proxy.empresa.local:8080",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client({ query: "x" });

    const call = fetchImpl.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[1]).toHaveProperty("dispatcher");
    expect(call[1]["dispatcher"]).toBeDefined();
  });

  it("normaliza a resposta e preserva facets", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        hits: [{ objectID: "1", id_plano: 1001 }],
        nbHits: 1,
        processingTimeMS: 2,
        facets: { servicos: { consultas: 1 } },
      }),
    );
    const client = createAlgoliaClient({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client({ query: "x" })).resolves.toEqual({
      hits: [{ objectID: "1", id_plano: 1001 }],
      nbHits: 1,
      processingTimeMS: 2,
      facets: { servicos: { consultas: 1 } },
    });
  });

  it.each([400, 403, 500])("converte HTTP %i em ALGOLIA_ERROR sem vazar credenciais", async (status) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "Invalid Application-ID or API key", key: CONFIG.apiKey }, status),
    );
    const client = createAlgoliaClient({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = await client({ query: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("ALGOLIA_ERROR");
    expect(appError.statusCode).toBe(502);
    expect(appError.publicMessage).toBe("Unable to query search provider.");

    const serialized = JSON.stringify(appError.toResponse("req-1"));
    expect(serialized).not.toContain(CONFIG.apiKey);
    expect(serialized).not.toContain(CONFIG.appId);
    expect(serialized).not.toContain(String(status));

    // A mensagem de log guarda o diagnostico, com a chave redigida.
    expect(appError.message).toContain(`HTTP ${status}`);
    expect(appError.message).toContain("Invalid Application-ID or API key");
    expect(appError.message).not.toContain(CONFIG.apiKey);
    expect(appError.message).toContain("[REDACTED]");
  });

  it("aborta por timeout e devolve ALGOLIA_TIMEOUT", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
    );
    const client = createAlgoliaClient({
      ...CONFIG,
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const error = await client({ query: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("ALGOLIA_TIMEOUT");
    expect((error as AppError).statusCode).toBe(504);
  });

  it("converte falha de rede em ALGOLIA_ERROR", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createAlgoliaClient({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = await client({ query: "x" }).catch((caught: unknown) => caught);
    expect((error as AppError).code).toBe("ALGOLIA_ERROR");
  });

  it("registra a causa raiz da falha de rede no log", async () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND appid.algolia.net"), {
      code: "ENOTFOUND",
    });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause });
    });
    const client = createAlgoliaClient({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = (await client({ query: "x" }).catch((caught: unknown) => caught)) as AppError;

    expect(error.message).toContain("TypeError: fetch failed");
    expect(error.message).toContain("ENOTFOUND");
    // A causa fica so no log; a resposta HTTP segue generica.
    expect(error.publicMessage).toBe("Unable to query search provider.");
  });

  it("registra causa de certificado nao confiavel", async () => {
    const cause = Object.assign(new Error("unable to verify the first certificate"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause });
    });
    const client = createAlgoliaClient({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = (await client({ query: "x" }).catch((caught: unknown) => caught)) as AppError;
    expect(error.message).toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });
});
