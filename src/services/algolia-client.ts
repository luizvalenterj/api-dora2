import { AppError } from "../errors/app-error.js";
import type { AlgoliaResponse, AlgoliaSearchFn, AlgoliaSearchParams } from "../types/algolia.js";

export interface AlgoliaClientConfig {
  appId: string;
  apiKey: string;
  indexName: string;
  timeoutMs: number;
  /** Injetavel apenas para teste; em producao usa o fetch nativo do Node. */
  fetchImpl?: typeof fetch;
}

interface AlgoliaQueryPayload {
  query: string;
  filters?: string;
  facets?: string[];
  restrictSearchableAttributes?: string[];
  attributesToRetrieve?: string[];
  hitsPerPage?: number;
  attributesToHighlight: string[];
  attributesToSnippet: string[];
}

function buildPayload(params: AlgoliaSearchParams): AlgoliaQueryPayload {
  return {
    query: params.query ?? "",
    ...(params.filters === undefined ? {} : { filters: params.filters }),
    ...(params.facets === undefined ? {} : { facets: params.facets }),
    ...(params.restrictSearchableAttributes === undefined
      ? {}
      : { restrictSearchableAttributes: params.restrictSearchableAttributes }),
    ...(params.attributesToRetrieve === undefined
      ? {}
      : { attributesToRetrieve: params.attributesToRetrieve }),
    ...(params.hitsPerPage === undefined ? {} : { hitsPerPage: params.hitsPerPage }),
    // Nao usamos highlighting: desligar economiza payload e processamento.
    attributesToHighlight: [],
    attributesToSnippet: [],
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function parseResponse(payload: unknown): AlgoliaResponse {
  if (typeof payload !== "object" || payload === null) {
    throw AppError.algolia("Algolia returned a non-object payload.");
  }

  const raw = payload as Partial<AlgoliaResponse>;

  return {
    hits: Array.isArray(raw.hits) ? raw.hits : [],
    nbHits: typeof raw.nbHits === "number" ? raw.nbHits : 0,
    processingTimeMS: typeof raw.processingTimeMS === "number" ? raw.processingTimeMS : 0,
    ...(raw.facets === undefined ? {} : { facets: raw.facets }),
  };
}

/**
 * Unico modulo que conhece host, headers e credenciais do Algolia.
 * Erros externos sao convertidos em `AppError` com mensagem publica generica:
 * nem credenciais nem corpo bruto do provedor chegam ao cliente.
 */
export function createAlgoliaClient(config: AlgoliaClientConfig): AlgoliaSearchFn {
  const url = `https://${config.appId}.algolia.net/1/indexes/${encodeURIComponent(
    config.indexName,
  )}/query`;

  return async function searchAlgolia(params: AlgoliaSearchParams): Promise<AlgoliaResponse> {
    const doFetch = config.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, config.timeoutMs);

    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          "X-Algolia-Application-Id": config.appId,
          "X-Algolia-API-Key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload(params)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw AppError.algolia(`Algolia responded with HTTP ${response.status}.`);
      }

      return parseResponse(await response.json());
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isAbortError(error)) {
        throw AppError.algoliaTimeout(`Algolia request aborted after ${config.timeoutMs}ms.`);
      }
      // Mensagem tecnica so no log; o cliente recebe texto generico.
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
      throw AppError.algolia(`Algolia request failed before a response was parsed (${reason}).`);
    } finally {
      clearTimeout(timeout);
    }
  };
}
