import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error.js";

/** Rotas publicas: usadas por health check do Render e por smoke test. */
const PUBLIC_ROUTES = new Set(["/", "/health"]);

function safeCompare(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

function routePath(request: FastifyRequest): string {
  const declared = request.routeOptions?.url;
  if (typeof declared === "string") return declared;
  return request.url.split("?")[0] ?? request.url;
}

/**
 * Hook `onRequest` que exige `Authorization: Bearer <API_ACCESS_KEY>`.
 * Sem `API_ACCESS_KEY` configurada a autenticacao fica desligada (uso local),
 * o que e sinalizado com warning no startup.
 */
export function createAuthHook(apiAccessKey: string | undefined) {
  return async function authHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (apiAccessKey === undefined) return;
    if (PUBLIC_ROUTES.has(routePath(request))) return;

    const token = extractBearerToken(request.headers.authorization);
    if (token === undefined || !safeCompare(token, apiAccessKey)) {
      throw AppError.unauthorized();
    }
  };
}
