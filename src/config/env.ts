import { z } from "zod";

/**
 * Unico ponto da aplicacao autorizado a ler `process.env`.
 * A validacao roda no startup: variavel obrigatoria ausente derruba o processo
 * com mensagem clara em vez de falhar silenciosamente na primeira requisicao.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /**
   * Interface de escuta. Fora de producao o padrao e `127.0.0.1`: o servidor
   * so aceita conexoes da propria maquina, sem ficar visivel na rede local.
   * Em producao o padrao e `0.0.0.0`, exigido por plataformas como o Render.
   */
  HOST: z.string().min(1).optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  ALGOLIA_APP_ID: z.string().min(1, "ALGOLIA_APP_ID is required"),
  ALGOLIA_SEARCH_API_KEY: z.string().min(1, "ALGOLIA_SEARCH_API_KEY is required"),
  ALGOLIA_INDEX_NAME: z.string().min(1, "ALGOLIA_INDEX_NAME is required"),
  ALGOLIA_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(8000),

  API_ACCESS_KEY: z.string().min(1).optional(),
})
  .transform((values) => ({
    ...values,
    HOST: values.HOST ?? (values.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  }));

export type Env = z.infer<typeof envSchema>;

/** Variaveis vazias (comuns em paineis de deploy) contam como ausentes. */
function withoutEmptyValues(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim() !== "") {
      result[key] = value;
    }
  }
  return result;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(withoutEmptyValues(source));

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}
