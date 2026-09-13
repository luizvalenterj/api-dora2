/**
 * Descobre o proxy de saida e testa o acesso ao Algolia por cada candidato.
 *
 * Funciona igual no Prompt de Comando, no PowerShell e no terminal do VS Code:
 *
 *   npm run proxy:detect
 *
 * Opcionalmente, passe a URL do PAC ou um proxy direto:
 *
 *   npm run proxy:detect -- http://pac.empresa/proxy.pac
 *   npm run proxy:detect -- http://proxy.empresa:8080
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const run = promisify(execFile);

const REGISTRY_PATH = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const ALGOLIA_APP_ID = process.env["ALGOLIA_APP_ID"] ?? "";
const TEST_URL =
  ALGOLIA_APP_ID === ""
    ? "https://www.algolia.com/"
    : `https://${ALGOLIA_APP_ID}.algolia.net/1/indexes`;

function describe(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; current instanceof Error && depth < 4; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    parts.push(`${current.message}${code === undefined ? "" : ` [${code}]`}`);
    current = current.cause;
  }

  return parts.join(" <- ");
}

/** Le uma chave das configuracoes de internet do Windows. */
async function readRegistry(name: string): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;

  try {
    const { stdout } = await run("reg", ["query", REGISTRY_PATH, "/v", name]);
    const match = /REG_SZ\s+(.+)\s*$/m.exec(stdout);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

async function readPacCandidates(pacUrl: string): Promise<string[]> {
  console.log(`\nLendo o PAC: ${pacUrl}`);

  try {
    const response = await undiciFetch(pacUrl);
    if (!response.ok) {
      console.log(`  nao foi possivel baixar (HTTP ${response.status})`);
      return [];
    }

    const pac = await response.text();
    const candidates = [
      ...new Set([...pac.matchAll(/PROXY\s+([^\s";]+)/gi)].map((match) => match[1] ?? "")),
    ].filter((candidate) => candidate !== "");

    console.log(
      candidates.length === 0
        ? "  nenhuma entrada PROXY encontrada (o PAC manda tudo DIRECT)"
        : `  proxies declarados: ${candidates.join(", ")}`,
    );
    return candidates;
  } catch (error) {
    console.log(`  falhou: ${describe(error)}`);
    return [];
  }
}

/**
 * Uma resposta HTTP nao prova que se chegou ao Algolia: um proxy ou gateway
 * pode responder 403 em nome dele. Por isso o corpo e sempre exibido.
 */
async function testProxy(proxy: string | undefined): Promise<boolean> {
  const label = proxy === undefined ? "conexao direta" : `via ${proxy}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await undiciFetch(TEST_URL, {
      method: "GET",
      signal: controller.signal,
      ...(proxy === undefined ? {} : { dispatcher: new ProxyAgent(proxy) }),
    });
    const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 120);
    console.log(`  ${label}: HTTP ${response.status}${body === "" ? "" : ` — ${body}`}`);
    return true;
  } catch (error) {
    console.log(`  ${label}: ${describe(error)}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  console.log(`Destino de teste: ${TEST_URL}`);

  const argument = process.argv[2];
  const candidates: string[] = [];

  if (argument !== undefined) {
    candidates.push(...(argument.endsWith(".pac") || argument.includes(".pac?")
      ? await readPacCandidates(argument)
      : [argument]));
  } else {
    const proxyServer = await readRegistry("ProxyServer");
    const autoConfigUrl = await readRegistry("AutoConfigURL");

    if (proxyServer !== undefined) {
      console.log(`\nProxy fixo no Windows: ${proxyServer}`);
      candidates.push(proxyServer);
    }
    if (autoConfigUrl !== undefined) {
      candidates.push(...(await readPacCandidates(autoConfigUrl)));
    }
    if (proxyServer === undefined && autoConfigUrl === undefined) {
      console.log("\nNenhum proxy configurado no Windows (ou nao e Windows).");
    }
  }

  const normalized = [
    ...new Set(candidates.map((c) => (c.startsWith("http") ? c : `http://${c}`))),
  ];

  console.log("\nTestando:");
  const direct = await testProxy(undefined);

  const working: string[] = [];
  for (const candidate of normalized) {
    if (await testProxy(candidate)) working.push(candidate);
  }

  console.log("\n--- Resultado ---");
  if (direct) {
    console.log("A conexao direta alcancou um servidor — nao e preciso configurar proxy.");
    console.log("Confira o corpo acima: se for uma pagina de bloqueio corporativo, quem");
    console.log("respondeu foi o filtro da rede, e nao o Algolia.");
  } else if (working.length > 0) {
    console.log("Adicione esta linha ao seu arquivo .env:\n");
    console.log(`  HTTPS_PROXY=${working[0]}`);
  } else if (normalized.length > 0) {
    console.log("Nenhum candidato conseguiu alcancar o destino.");
    console.log("Se a falha cita 407, o proxy exige autenticacao:");
    console.log("  HTTPS_PROXY=http://usuario:senha@host:porta");
    console.log("Se cita certificado, aponte NODE_EXTRA_CA_CERTS para a raiz corporativa.");
  } else {
    console.log("Sem proxy e sem conexao direta: o bloqueio e de firewall ou DNS.");
    console.log("Peca a liberacao de *.algolia.net e *.algolianet.com na porta 443.");
  }
}

main().catch((error: unknown) => {
  console.error(describe(error));
  process.exit(1);
});
