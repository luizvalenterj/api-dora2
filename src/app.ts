import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { AppError } from "./errors/app-error.js";
import { createAuthHook } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { searchRoutes } from "./routes/search.js";
import type { SearchService } from "./services/search-service.js";

export interface BuildAppOptions {
  searchService: SearchService;
  /** Ausente desliga a autenticacao (somente uso local). */
  apiAccessKey?: string | undefined;
  logger?: FastifyServerOptions["logger"];
  exposeErrorDetails?: boolean;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  // Erros do proprio Fastify (JSON malformado, payload grande, etc.).
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return AppError.badRequest("Malformed request.");
  }

  return AppError.internal(error instanceof Error ? error.message : "Unknown error.");
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
    trustProxy: true,
  });

  app.addHook("onRequest", createAuthHook(options.apiAccessKey));

  app.setErrorHandler((error, request, reply) => {
    const appError = toAppError(error);

    const logPayload = {
      request_id: request.id,
      route: `${request.method} ${request.url}`,
      code: appError.code,
      status: appError.statusCode,
    };

    if (appError.statusCode >= 500) {
      request.log.error({ ...logPayload, err: error }, appError.message);
    } else {
      request.log.warn(logPayload, appError.message);
    }

    return reply.status(appError.statusCode).send(appError.toResponse(request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    const appError = AppError.notFound();
    return reply.status(appError.statusCode).send(appError.toResponse(request.id));
  });

  app.register(healthRoutes);
  app.register(searchRoutes, { searchService: options.searchService });

  return app;
}
