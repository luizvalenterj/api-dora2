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

  if (env.API_ACCESS_KEY === undefined) {
    app.log.warn("API_ACCESS_KEY is not set: /v1/search is running without authentication.");
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, "shutting down");
      void app.close().then(() => process.exit(0));
    });
  }

  // Render exige bind em 0.0.0.0 — `localhost` nao recebe trafego externo.
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
