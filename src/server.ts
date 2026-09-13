import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { createAlgoliaClient } from "./services/algolia-client.js";
import { createSearchService } from "./services/search-service.js";

async function main(): Promise<void> {
  const env = loadEnv();

  const algoliaClient = createAlgoliaClient({
    appId: env.ALGOLIA_APP_ID,
    apiKey: env.ALGOLIA_SEARCH_API_KEY,
    indexName: env.ALGOLIA_INDEX_NAME,
    timeoutMs: env.ALGOLIA_TIMEOUT_MS,
    proxyUrl: env.PROXY_URL,
  });

  const app = buildApp({
    searchService: createSearchService(algoliaClient),
    apiAccessKey: env.API_ACCESS_KEY,
    logger: {
      level: env.LOG_LEVEL,
      // Credenciais nunca chegam ao log.
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        remove: true,
      },
    },
  });

  if (env.PROXY_URL !== undefined) {
    app.log.info({ proxy: env.PROXY_URL }, "outbound requests go through a proxy");
  }

  if (env.API_ACCESS_KEY === undefined) {
    app.log.warn("API_ACCESS_KEY is not set: /v1/search is running without authentication.");
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, "shutting down");
      void app.close().then(() => process.exit(0));
    });
  }

  // Local: 127.0.0.1 (so a propria maquina). Producao: 0.0.0.0, exigido pelo
  // Render. Veja HOST em src/config/env.ts.
  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
