import type { FastifyPluginAsync } from "fastify";

/** Rotas publicas de liveness. Nao consultam o Algolia. */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({
    service: "health-network-api",
    status: "ok",
  }));

  app.get("/health", async () => ({
    status: "healthy",
  }));
};
