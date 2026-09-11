import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../errors/app-error.js";
import { searchRequestSchema } from "../schemas/search.schema.js";
import type { SearchService } from "../services/search-service.js";

export interface SearchRoutesOptions {
  searchService: SearchService;
}

/**
 * Camada HTTP pura: valida, delega e loga. Nenhuma regra de Algolia aqui.
 */
export const searchRoutes: FastifyPluginAsync<SearchRoutesOptions> = async (app, options) => {
  app.post("/v1/search", async (request, reply) => {
    const parsed = searchRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      throw AppError.validation(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }

    const startedAt = process.hrtime.bigint();
    const { response, diagnostics } = await options.searchService.search(parsed.data);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    request.log.info(
      {
        request_id: request.id,
        route: "POST /v1/search",
        return_type: parsed.data.return_type,
        search_scope: parsed.data.search_scope,
        filter_count: diagnostics.filter_count,
        used_query: diagnostics.used_query,
        nb_hits: diagnostics.nb_hits,
        algolia_ms: diagnostics.algolia_ms,
        total_ms: Number(elapsedMs.toFixed(2)),
        count: response.count,
        status: 200,
      },
      "search completed",
    );

    return reply.status(200).send(response);
  });
};
