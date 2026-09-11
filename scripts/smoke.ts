/**
 * Smoke test contra o indice Algolia REAL.
 *
 * Nao versiona credencial: tudo vem de variavel de ambiente.
 *
 *   ALGOLIA_APP_ID=... ALGOLIA_SEARCH_API_KEY=... ALGOLIA_INDEX_NAME=... npm run smoke
 *
 * Opcional: passe um texto para resolver um plano especifico.
 *
 *   npm run smoke -- "Bradesco Nacional Flex"
 */
import { loadEnv } from "../src/config/env.js";
import { createAlgoliaClient } from "../src/services/algolia-client.js";
import { createSearchService } from "../src/services/search-service.js";
import { searchRequestSchema, type SearchRequestInput } from "../src/schemas/search.schema.js";
import type { PlanoItem, UnidadeItem } from "../src/types/api.js";

const env = loadEnv();
const service = createSearchService(
  createAlgoliaClient({
    appId: env.ALGOLIA_APP_ID,
    apiKey: env.ALGOLIA_SEARCH_API_KEY,
    indexName: env.ALGOLIA_INDEX_NAME,
    timeoutMs: env.ALGOLIA_TIMEOUT_MS,
  }),
);

async function run(label: string, input: SearchRequestInput): Promise<unknown[]> {
  const { response } = await service.search(searchRequestSchema.parse(input));
  console.log(`\n# ${label}`);
  console.log(`  request : ${JSON.stringify(input)}`);
  console.log(`  count=${response.count} nb_hits=${response.meta.nb_hits} (${response.meta.processing_time_ms}ms)`);
  for (const item of response.items.slice(0, 10)) {
    console.log(`  - ${typeof item === "string" ? item : JSON.stringify(item)}`);
  }
  return response.items;
}

async function main(): Promise<void> {
  const termo = process.argv[2];
  console.log(`indice: ${env.ALGOLIA_INDEX_NAME} | app: ${env.ALGOLIA_APP_ID}`);

  // 1. Amostra do indice: confirma schema e traz IDs reais para os passos seguintes.
  const amostra = (await run("amostra de registros", { return_type: "records", limit: 3 })) as Array<{
    id_plano?: number;
    id_unidade?: number;
  }>;

  if (amostra.length === 0) {
    console.log("\nIndice vazio ou sem permissao de leitura para esta chave.");
    return;
  }

  // 2. Busca textual: resolve um plano por nome.
  const planos = (await run("planos (busca textual)", {
    ...(termo === undefined ? {} : { query: termo }),
    search_scope: "plano",
    return_type: "planos",
    limit: 5,
  })) as PlanoItem[];

  const idPlano = planos[0]?.id ?? amostra[0]?.id_plano;
  if (idPlano === undefined) return;

  // 3. Relacoes a partir do ID resolvido.
  const unidades = (await run("unidades do plano", {
    id_plano: idPlano,
    return_type: "unidades",
    limit: 10,
  })) as UnidadeItem[];

  const idUnidade = unidades[0]?.id ?? amostra[0]?.id_unidade;
  if (idUnidade === undefined) return;

  const servicos = (await run("servicos do plano na unidade", {
    id_plano: idPlano,
    id_unidade: idUnidade,
    return_type: "servicos",
  })) as string[];

  await run("planos aceitos na unidade", { id_unidade: idUnidade, return_type: "planos", limit: 10 });
  await run("convenios na unidade", { id_unidade: idUnidade, return_type: "convenios", limit: 10 });

  const servico = servicos[0];
  if (servico !== undefined) {
    await run("validacao da relacao plano + unidade + servico", {
      id_plano: idPlano,
      id_unidade: idUnidade,
      servico,
      return_type: "records",
    });
    await run("unidades do plano com esse servico", {
      id_plano: idPlano,
      servico,
      return_type: "unidades",
      limit: 10,
    });
  }

  console.log("\nOK: o indice respondeu a todas as consultas.");
}

main().catch((error: unknown) => {
  console.error(`\nFALHOU: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
