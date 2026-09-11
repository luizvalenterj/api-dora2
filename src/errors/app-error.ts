export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "ALGOLIA_ERROR"
  | "ALGOLIA_TIMEOUT"
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  success: false;
  error: {
    code: AppErrorCode;
    message: string;
    details?: unknown;
  };
  request_id: string;
}

interface AppErrorOptions {
  /** Mensagem segura, devolvida ao cliente. Nunca contem credenciais. */
  publicMessage: string;
  /** Mensagem interna usada apenas em log. */
  logMessage?: string;
  /** Detalhes seguros (ex.: issues do Zod). Nunca incluir dados sensiveis. */
  details?: unknown;
}

/**
 * Erro de aplicacao com contrato HTTP estavel.
 *
 * A separacao entre `publicMessage` (resposta) e `message` (log) garante que
 * detalhes de provedores externos nunca vazem para o agente consumidor.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly publicMessage: string;
  readonly details: unknown;

  constructor(code: AppErrorCode, statusCode: number, options: AppErrorOptions) {
    super(options.logMessage ?? options.publicMessage);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.publicMessage = options.publicMessage;
    this.details = options.details;
  }

  toResponse(requestId: string): ErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.publicMessage,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
      request_id: requestId,
    };
  }

  static badRequest(publicMessage: string, details?: unknown): AppError {
    return new AppError("BAD_REQUEST", 400, { publicMessage, ...(details === undefined ? {} : { details }) });
  }

  static unauthorized(publicMessage = "Missing or invalid access credentials."): AppError {
    return new AppError("UNAUTHORIZED", 401, { publicMessage });
  }

  static validation(details?: unknown): AppError {
    return new AppError("VALIDATION_ERROR", 422, {
      publicMessage: "Invalid request payload.",
      ...(details === undefined ? {} : { details }),
    });
  }

  static notFound(publicMessage = "Resource not found."): AppError {
    return new AppError("NOT_FOUND", 404, { publicMessage });
  }

  /** Falha do provedor de busca. O status upstream fica somente no log. */
  static algolia(logMessage: string): AppError {
    return new AppError("ALGOLIA_ERROR", 502, {
      publicMessage: "Unable to query search provider.",
      logMessage,
    });
  }

  static algoliaTimeout(logMessage = "Algolia request aborted by timeout."): AppError {
    return new AppError("ALGOLIA_TIMEOUT", 504, {
      publicMessage: "Search provider timed out.",
      logMessage,
    });
  }

  static internal(logMessage = "Unexpected internal error."): AppError {
    return new AppError("INTERNAL_ERROR", 500, {
      publicMessage: "Internal server error.",
      logMessage,
    });
  }
}
