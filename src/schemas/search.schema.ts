import { z } from "zod";

export const SEARCH_SCOPES = ["all", "convenio", "plano", "unidade", "localizacao"] as const;
export const RETURN_TYPES = ["records", "convenios", "planos", "unidades", "servicos"] as const;

/**
 * Contrato aceito pelo endpoint. `.strict()` e deliberado: o cliente nunca pode
 * enviar `filters`, `facets`, `restrictSearchableAttributes` ou qualquer outro
 * parametro Algolia. Esses detalhes pertencem exclusivamente a API.
 */
export const searchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),

    id_convenio: z.number().int().positive().optional(),
    id_plano: z.number().int().positive().optional(),
    id_unidade: z.number().int().positive().optional(),

    servico: z.string().trim().min(1).max(100).optional(),
    cidade: z.string().trim().min(1).max(100).optional(),
    bairro: z.string().trim().min(1).max(100).optional(),

    search_scope: z.enum(SEARCH_SCOPES).default("all"),
    return_type: z.enum(RETURN_TYPES),

    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export type SearchScope = (typeof SEARCH_SCOPES)[number];
export type ReturnType = (typeof RETURN_TYPES)[number];

/** Request ja validado e com defaults aplicados. */
export type SearchRequest = z.infer<typeof searchRequestSchema>;

/** Formato aceito na entrada (antes dos defaults). */
export type SearchRequestInput = z.input<typeof searchRequestSchema>;
