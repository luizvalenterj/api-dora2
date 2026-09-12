import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const REQUIRED = {
  ALGOLIA_APP_ID: "APPID123",
  ALGOLIA_SEARCH_API_KEY: "search-key",
  ALGOLIA_INDEX_NAME: "rede_credenciada",
};

describe("loadEnv", () => {
  it("aplica defaults documentados", () => {
    const env = loadEnv({ ...REQUIRED });
    expect(env.PORT).toBe(3000);
    expect(env.ALGOLIA_TIMEOUT_MS).toBe(8000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.API_ACCESS_KEY).toBeUndefined();
  });

  it("escuta apenas em loopback fora de producao", () => {
    expect(loadEnv({ ...REQUIRED }).HOST).toBe("127.0.0.1");
    expect(loadEnv({ ...REQUIRED, NODE_ENV: "development" }).HOST).toBe("127.0.0.1");
  });

  it("escuta em todas as interfaces em producao", () => {
    expect(loadEnv({ ...REQUIRED, NODE_ENV: "production" }).HOST).toBe("0.0.0.0");
  });

  it("HOST explicito tem precedencia sobre o padrao", () => {
    expect(loadEnv({ ...REQUIRED, NODE_ENV: "production", HOST: "127.0.0.1" }).HOST).toBe(
      "127.0.0.1",
    );
    expect(loadEnv({ ...REQUIRED, HOST: "0.0.0.0" }).HOST).toBe("0.0.0.0");
  });

  it("converte numeros vindos como string", () => {
    const env = loadEnv({ ...REQUIRED, PORT: "10000", ALGOLIA_TIMEOUT_MS: "1500" });
    expect(env.PORT).toBe(10_000);
    expect(env.ALGOLIA_TIMEOUT_MS).toBe(1500);
  });

  it("falha com mensagem clara quando falta variavel obrigatoria", () => {
    expect(() => loadEnv({ ALGOLIA_APP_ID: "APPID123" })).toThrow(/ALGOLIA_SEARCH_API_KEY/);
  });

  it("trata variavel vazia como ausente", () => {
    expect(() => loadEnv({ ...REQUIRED, ALGOLIA_INDEX_NAME: "   " })).toThrow(
      /ALGOLIA_INDEX_NAME/,
    );
  });
});
