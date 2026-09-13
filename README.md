# API da Dora 2

API intermediária entre um agente de IA (LLM) e um índice Algolia com a rede credenciada de planos de saúde.

O agente nunca fala com o Algolia. Ele chama uma única tool — `search_health_network` — e esta API traduz o pedido em consulta determinística ao índice.

```
LLM entende.
API controla.
Algolia determina a verdade.
```

## Índice

- [Objetivo](#objetivo)
- [Arquitetura](#arquitetura)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Execução local](#execução-local)
- [Build e produção](#build-e-produção)
- [Testes](#testes)
- [Contrato HTTP](#contrato-http)
- [Tool do LLM](#tool-do-llm)
- [Exemplos curl](#exemplos-curl)
- [Deploy no Render](#deploy-no-render)
- [Solução de problemas](#solução-de-problemas)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Decisões técnicas](#decisões-técnicas)

## Objetivo

Responder, com base no índice e não no conhecimento do modelo, perguntas como:

- Onde meu plano é aceito?
- O São Luiz Morumbi aceita Bradesco Nacional Flex?
- Quais serviços esse plano possui no São Luiz Itaim?
- Onde consigo fazer exames com meu plano?
- Quais planos são aceitos no Copa D'Or?
- O plano X possui emergência na unidade Y?
- Quais unidades no Rio de Janeiro aceitam o plano X?

## Arquitetura

```
Usuário
   ↓
LLM / Agente
   ↓
Tool: search_health_network
   ↓
API Node.js  (validação Zod → filtros → scope → normalização)
   ↓
Algolia Search REST API
   ↓
Índice de cobertura
   ↓
API normaliza o resultado
   ↓
LLM responde ao usuário
```

O princípio central é a separação entre **SEARCH** e **FILTER**:

| Etapa | Para quê | Como |
| --- | --- | --- |
| SEARCH | Descobrir a entidade a partir de texto (`"Bradesco Nacional Flex"` → `id_plano: 1001`) | `query` + `search_scope` → `restrictSearchableAttributes` |
| FILTER | Validar a relação real entre entidades | `id_plano` / `id_unidade` / `servico` → `filters` exatos |

Similaridade textual **nunca** é usada para afirmar cobertura.

O cliente não envia `filters`, `facets`, `restrictSearchableAttributes` nem nome de índice: o schema de request é `strict` e rejeita esses campos com HTTP 422.

### Registro no índice

```json
{
  "objectID": "101_1001_201",
  "id_convenio": 101,
  "nome_convenio": "Bradesco",
  "id_plano": 1001,
  "nome_plano": "Bradesco Nacional Flex",
  "id_unidade": 201,
  "nome_unidade": "São Luiz Morumbi",
  "cidade_unidade": "São Paulo",
  "bairro_unidade": "Morumbi",
  "servicos": ["consultas", "exames", "internacao"]
}
```

Cada registro é a combinação convênio + plano + unidade + serviços. Como o mesmo plano aparece em várias unidades, a API deduplica sempre **por ID** (`id_convenio`, `id_plano`, `id_unidade`), nunca por nome.

Os serviços não são uma lista fechada no código: qualquer valor presente no array `servicos` do índice (`oncologia`, `uti`, `maternidade`, …) funciona.

## Requisitos

- Node.js 22 ou superior
- npm 10 ou superior
- Um índice Algolia com o schema acima e uma Search API Key restrita a busca

## Instalação

```bash
npm install
```

## Variáveis de ambiente

Copie `.env.example` e preencha. As variáveis são validadas com Zod no startup: faltando uma obrigatória, o processo falha imediatamente com mensagem clara.

| Variável | Obrigatória | Padrão | Descrição |
| --- | --- | --- | --- |
| `ALGOLIA_APP_ID` | sim | — | Application ID do Algolia |
| `ALGOLIA_SEARCH_API_KEY` | sim | — | Search API Key (**nunca** a Admin Key) |
| `ALGOLIA_INDEX_NAME` | sim | — | Nome do índice de cobertura (`cobertura_convenios_planos`) |
| `API_ACCESS_KEY` | recomendada | — | Bearer token exigido em `/v1/search`. Ausente, a autenticação fica desligada e um warning é logado |
| `ALGOLIA_TIMEOUT_MS` | não | `8000` | Timeout da chamada ao Algolia (`AbortController`) |
| `LOG_LEVEL` | não | `info` | `fatal`…`trace`, `silent` |
| `NODE_ENV` | não | `development` | `development` \| `test` \| `production` |
| `PORT` | não | `3000` | Porta HTTP (o Render injeta a sua) |
| `HOST` | não | `127.0.0.1` local / `0.0.0.0` em produção | Interface de escuta |
| `HTTPS_PROXY` / `HTTP_PROXY` | não | — | Proxy de saída, quando a rede exige um. `HTTPS_PROXY` tem precedência |

As credenciais do Algolia ficam confinadas ao módulo `src/services/algolia-client.ts` e nunca são logadas nem devolvidas em respostas de erro. O agente recebe apenas o `API_ACCESS_KEY`.

## Execução local

```bash
npm install
npm run dev
```

Crie um arquivo **`.env` na raiz do projeto** (já está no `.gitignore`, então nunca é versionado):

```env
ALGOLIA_APP_ID=seu-app-id
ALGOLIA_SEARCH_API_KEY=sua-search-api-key
ALGOLIA_INDEX_NAME=cobertura_convenios_planos
API_ACCESS_KEY=uma-chave-qualquer-para-uso-local
PORT=3000
```

`npm run dev`, `npm start` e `npm run smoke` carregam esse arquivo automaticamente (via `--env-file-if-exists` do Node) — sem `.env`, valem as variáveis já exportadas no ambiente. `npm run dev` usa `tsx watch` e recarrega a cada alteração.

Fora de produção o servidor escuta **apenas em `127.0.0.1`**: ele responde a `http://localhost:3000` na própria máquina e recusa qualquer conexão vinda da rede. Nada fica exposto e não é preciso liberar porta em firewall. Para expor deliberadamente (um container, outra máquina da rede), defina `HOST=0.0.0.0` — e aí configure `API_ACCESS_KEY`, porque a API deixa de estar protegida pelo isolamento de rede.

A única conexão de saída é a consulta ao Algolia, que é a fonte de dados da API.

## Build e produção

```bash
npm run build   # tsc → dist/
npm start       # node dist/server.js
```

Scripts disponíveis:

| Script | O que faz |
| --- | --- |
| `npm run dev` | Servidor em watch mode |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm start` | Executa o código compilado |
| `npm test` | Roda os testes (Vitest) |
| `npm run typecheck` | Type-check de `src/`, `tests/` e `scripts/` |
| `npm run test:integration` | Testes contra o índice Algolia real (opt-in) |
| `npm run smoke -- "texto"` | Consulta o índice real e imprime os casos de uso |

## Testes

```bash
npm test
```

Os testes unitários não dependem do Algolia real nem de rede: `tests/helpers/fake-algolia.ts` é um Algolia falso e determinístico que interpreta a expressão de filtros gerada pela API sobre um dataset sintético. Cobrem filter builder e escaping, scope builder, deduplicação, extração de serviços, cliente Algolia (timeout e HTTP 400/403/500 sem vazar credenciais), autenticação Bearer e o contrato HTTP completo.

### Contra o índice real (opt-in)

Os testes de integração vivem em `tests/integration/` e são **pulados por padrão**. Rodam apenas com `RUN_INTEGRATION=1` e as credenciais no ambiente:

```bash
RUN_INTEGRATION=1 \
ALGOLIA_APP_ID=... \
ALGOLIA_SEARCH_API_KEY=... \
ALGOLIA_INDEX_NAME=cobertura_convenios_planos \
npm run test:integration
```

As asserções são agnósticas ao dataset: pegam um registro real do índice e a partir dele validam o schema, a resolução textual do plano, a deduplicação por ID, os serviços da relação plano + unidade e o filtro geográfico.

Para uma checagem manual e legível do índice, existe também um smoke test que imprime o resultado de cada caso de uso:

```bash
npm run smoke -- "Bradesco Nacional Flex"
```

Com as credenciais no `.env` não é preciso passar nada; sem ele, exporte `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY` e `ALGOLIA_INDEX_NAME` antes.

O argumento de texto é opcional — sem ele, o script descobre um plano a partir de uma amostra do próprio índice.

## Contrato HTTP

### `GET /`

Sem autenticação.

```json
{ "service": "health-network-api", "status": "ok" }
```

### `GET /health`

Sem autenticação. Não consulta o Algolia — é o health check do Render.

```json
{ "status": "healthy" }
```

### `POST /v1/search`

Exige `Authorization: Bearer <API_ACCESS_KEY>` quando a chave está configurada.

Request:

```ts
type SearchScope = "all" | "convenio" | "plano" | "unidade" | "localizacao";
type ReturnType = "records" | "convenios" | "planos" | "unidades" | "servicos";

interface SearchRequest {
  query?: string;

  id_convenio?: number;
  id_plano?: number;
  id_unidade?: number;

  servico?: string;
  cidade?: string;
  bairro?: string;

  search_scope?: SearchScope; // default: "all"
  return_type: ReturnType;    // obrigatório
  limit?: number;             // 1..100, default: 20
}
```

`search_scope` controla onde a busca textual acontece (só tem efeito com `query`):

| scope | atributos pesquisados |
| --- | --- |
| `all` | não restringe |
| `convenio` | `nome_convenio` |
| `plano` | `nome_plano` |
| `unidade` | `nome_unidade` |
| `localizacao` | `cidade_unidade`, `bairro_unidade` |

`return_type` é uma abstração desta API (não existe no Algolia) e define o formato da resposta:

| return_type | Resposta |
| --- | --- |
| `records` | Registros de cobertura — use para validar uma combinação específica |
| `convenios` | Convênios distintos |
| `planos` | Planos distintos |
| `unidades` | Unidades distintas |
| `servicos` | Lista de strings de serviços |

Resposta de sucesso:

```json
{
  "success": true,
  "return_type": "unidades",
  "count": 2,
  "items": [
    { "id": 201, "nome": "São Luiz Morumbi", "cidade": "São Paulo", "bairro": "Morumbi" },
    { "id": 202, "nome": "São Luiz Itaim", "cidade": "São Paulo", "bairro": "Itaim Bibi" }
  ],
  "meta": { "nb_hits": 4, "processing_time_ms": 2 }
}
```

`count` é o número de itens devolvidos após deduplicação e `limit`; `meta.nb_hits` é o total de registros que casaram no índice.

Ausência de resultado **não** é interpretada semanticamente — a API nunca responde "seu plano não cobre emergência". Ela devolve:

```json
{ "success": true, "return_type": "records", "count": 0, "items": [], "meta": { "nb_hits": 0, "processing_time_ms": 1 } }
```

porque ausência pode significar cobertura inexistente, dado incompleto, índice desatualizado ou entidade errada. Quem decide como comunicar isso é o agente. Da mesma forma, em caso de ambiguidade a API devolve **todas** as entidades plausíveis, sem escolher por conta própria.

### Erros

```json
{
  "success": false,
  "error": { "code": "ALGOLIA_ERROR", "message": "Unable to query search provider." },
  "request_id": "370c2d0c-..."
}
```

| Status | Código | Quando |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | JSON malformado |
| 401 | `UNAUTHORIZED` | Bearer ausente ou inválido |
| 404 | `NOT_FOUND` | Rota inexistente |
| 422 | `VALIDATION_ERROR` | Body reprovado pelo Zod (inclui campo não permitido, como `filters`) |
| 502 | `ALGOLIA_ERROR` | Falha do Algolia |
| 504 | `ALGOLIA_TIMEOUT` | Timeout do Algolia |
| 500 | `INTERNAL_ERROR` | Erro inesperado |

Todo request recebe um `request_id` (UUID) presente na resposta de erro e nos logs. Stack traces e detalhes do provedor nunca são devolvidos ao cliente.

## Tool do LLM

O contrato da tool está em [`tool-schema.json`](./tool-schema.json) e espelha exatamente o body aceito por `POST /v1/search`.

Prompt esperado do agente consumidor:

```
Você é um assistente especializado em rede credenciada.

Nunca responda informações específicas sobre aceitação de planos, unidades
ou serviços utilizando apenas conhecimento próprio.

Use search_health_network como fonte de verdade.

Quando houver somente o nome de uma entidade, utilize busca textual para
identificá-la.

Depois que uma entidade for identificada, mantenha seu ID no contexto e
prefira o ID nas próximas consultas.

Busca textual serve para identificar entidades.
IDs e filtros exatos servem para validar relações.

Se houver múltiplas correspondências plausíveis, não escolha arbitrariamente.

Não exponha detalhes técnicos do Algolia ao usuário.
```

A API é **stateless**: o contexto conversacional (o `id_plano` já resolvido, por exemplo) pertence ao agente.

### Fluxo de referência

```
"Onde faço exames com Bradesco Nacional Flex?"
   ↓
search_health_network({ query: "Bradesco Nacional Flex", search_scope: "plano", return_type: "planos" })
   → { id: 1001, nome: "Bradesco Nacional Flex" }
   ↓
o agente guarda id_plano = 1001
   ↓
search_health_network({ id_plano: 1001, servico: "exames", return_type: "unidades" })
   → filters: id_plano:1001 AND servicos:"exames"
   → unidades deduplicadas por id_unidade
```

## Exemplos curl

Health:

```bash
curl https://SEU-SERVICO.onrender.com/health
```

Resolver plano:

```bash
curl -X POST \
  https://SEU-SERVICO.onrender.com/v1/search \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Bradesco Nacional Flex",
    "search_scope": "plano",
    "return_type": "planos"
  }'
```

Unidades onde o plano é aceito:

```bash
curl -X POST \
  https://SEU-SERVICO.onrender.com/v1/search \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id_plano": 1001,
    "return_type": "unidades"
  }'
```

Serviços de um plano numa unidade:

```bash
curl -X POST \
  https://SEU-SERVICO.onrender.com/v1/search \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id_plano": 1001,
    "id_unidade": 201,
    "return_type": "servicos"
  }'
```

Onde fazer exames:

```bash
curl -X POST \
  https://SEU-SERVICO.onrender.com/v1/search \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id_plano": 1001,
    "servico": "exames",
    "return_type": "unidades"
  }'
```

Verificar emergência numa unidade:

```bash
curl -X POST \
  https://SEU-SERVICO.onrender.com/v1/search \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id_plano": 1001,
    "id_unidade": 201,
    "servico": "emergencia",
    "return_type": "records"
  }'
```

Unidades do plano numa cidade:

```bash
curl -X POST \
  https://SEU-SERVICO.onrender.com/v1/search \
  -H "Authorization: Bearer SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id_plano": 1001,
    "cidade": "Rio de Janeiro",
    "return_type": "unidades"
  }'
```

## Deploy no Render

O [`render.yaml`](./render.yaml) já descreve o serviço (nenhum secret versionado):

| Campo | Valor |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/health` |

Passos:

1. Crie um Web Service apontando para este repositório (ou use o Blueprint com `render.yaml`).
2. Configure no dashboard os secrets marcados com `sync: false`: `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY` e `API_ACCESS_KEY` (o `ALGOLIA_INDEX_NAME` já vem no arquivo).
3. Faça o deploy e valide com `curl https://SEU-SERVICO.onrender.com/health`.

Com `NODE_ENV=production` (já no `render.yaml`) a aplicação escuta em `0.0.0.0` na porta de `PORT` — o Render não roteia tráfego para `localhost`.

## Solução de problemas

### `502 ALGOLIA_ERROR` com `TypeError: fetch failed`

Falha de rede antes de qualquer resposta HTTP. O log do servidor traz a cadeia de causas — é ela que diz o que fazer:

| Causa no log | Significado | Caminho |
| --- | --- | --- |
| `ENOTFOUND` | DNS não resolveu o host | Rede/VPN sem acesso ao domínio, ou proxy obrigatório |
| `ECONNREFUSED` / `ETIMEDOUT` | Conexão bloqueada | Firewall corporativo; liberar `*.algolia.net` e `*.algolianet.com` |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN` | TLS interceptado por proxy corporativo | Apontar `NODE_EXTRA_CA_CERTS` para o certificado raiz da empresa |
| `Host not in allowlist` (com HTTP 403) | Egresso bloqueado por política do ambiente | Liberar o host nas configurações de rede do ambiente |

Para ver a causa direto, sem subir o servidor:

```bash
node --env-file-if-exists=.env -e 'fetch(`https://${process.env.ALGOLIA_APP_ID}.algolia.net/1/indexes`).then(r=>console.log("HTTP",r.status)).catch(e=>console.log(e.name,e.message,"|",e.cause?.code,e.cause?.message))'
```

Com TLS interceptado, aponte o certificado raiz da empresa (formato PEM) e rode de novo:

```bash
NODE_EXTRA_CA_CERTS=/caminho/para/raiz-corporativa.pem npm start
```

Nunca use `NODE_TLS_REJECT_UNAUTHORIZED=0`: isso desliga a verificação de certificado para todas as conexões do processo.

### Rede que exige proxy

O `fetch` do Node **ignora** `HTTP_PROXY`/`HTTPS_PROXY` por conta própria, e o curl não usa o proxy do sistema (WPAD/PAC) — só variáveis de ambiente. Por isso é comum o navegador funcionar enquanto Node e curl falham com `fetch failed`.

A aplicação aplica o proxy explicitamente: basta definir a variável no `.env`.

```env
HTTPS_PROXY=http://proxy.empresa.local:8080
```

Para descobrir o endereço no Windows:

```powershell
netsh winhttp show proxy
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' |
  Select-Object ProxyEnable, ProxyServer, AutoConfigURL
npm config get https-proxy
```

Se só aparecer `AutoConfigURL`, a rede usa PAC: abra essa URL no navegador e procure o `PROXY host:porta` correspondente.

Com proxy configurado, o log de inicialização registra `outbound requests go through a proxy`, e uma recusa do próprio proxy aparece como `Proxy response (403) !== 200 when HTTP Tunneling`.

## Estrutura do projeto

```
api-dora2/
├── src/
│   ├── server.ts                  # bootstrap: env → client → app → listen
│   ├── app.ts                     # montagem do Fastify, error handler, hooks
│   ├── config/env.ts              # única leitura de process.env, validada com Zod
│   ├── routes/
│   │   ├── health.ts              # GET / e GET /health (públicos)
│   │   └── search.ts              # POST /v1/search (valida, delega, loga)
│   ├── schemas/search.schema.ts   # contrato de request (strict)
│   ├── services/
│   │   ├── algolia-client.ts      # único módulo com credenciais e REST do Algolia
│   │   └── search-service.ts      # orquestração da busca
│   ├── search/
│   │   ├── filter-builder.ts      # campos tipados → expressão `filters` + escaping
│   │   ├── scope-builder.ts       # search_scope → restrictSearchableAttributes
│   │   └── normalizers.ts         # deduplicação por ID, serviços, attributesToRetrieve
│   ├── plugins/auth.ts            # hook Bearer com comparação timing-safe
│   ├── errors/app-error.ts        # erro de aplicação com mensagem pública x de log
│   └── types/
│       ├── algolia.ts             # tipos do índice e da resposta do Algolia
│       └── api.ts                 # tipos da resposta da API
├── scripts/smoke.ts               # checagem manual contra o índice real
├── tests/
│   ├── helpers/fake-algolia.ts    # Algolia falso determinístico + dataset sintético
│   ├── integration/               # testes contra o índice real (opt-in)
│   ├── algolia-client.test.ts
│   ├── api.test.ts
│   ├── auth.test.ts
│   ├── env.test.ts
│   ├── filter-builder.test.ts
│   ├── normalizers.test.ts
│   ├── scope-builder.test.ts
│   └── search-service.test.ts
├── .env.example
├── render.yaml
├── tool-schema.json
├── tsconfig.json
├── tsconfig.test.json
└── vitest.config.ts
```

## Decisões técnicas

- **REST direto, sem SDK do Algolia.** Uma única chamada `POST /1/indexes/{index}/query` com `fetch` nativo e `AbortController` cobre o MVP; menos dependência, menos superfície.
- **Injeção de dependência em vez de mock de módulo.** `buildApp` recebe o `SearchService` e `createSearchService` recebe a função de busca. Os testes montam a aplicação inteira sem rede e sem variável de ambiente.
- **`strict()` no schema de request.** Rejeitar campo desconhecido é o que impede o cliente de contrabandear `filters`/`facets` do Algolia.
- **Escaping centralizado.** Valores de texto entram entre aspas duplas com `\` e `"` neutralizados; IDs passam por `Number.isSafeInteger` antes de virar cláusula. Nada de concatenação de filtro fora de `filter-builder.ts`.
- **Mensagem pública separada da mensagem de log** no `AppError`: o log guarda `HTTP 403 do Algolia`, o cliente recebe `Unable to query search provider.`
- **Leitura ampliada de hits em respostas agregadas.** Como vários registros colapsam num item após a deduplicação, consultas agregadas pedem `max(limit × 10, 200)` hits (teto de 1000) e cortam pelo `limit` no fim; `records` usa o `limit` direto.
- **`servicos` via facet com fallback.** A resposta usa o facet `servicos` quando disponível e cai para agregação sobre os hits caso o atributo não esteja declarado como `attributeForFaceting` — nenhuma mudança no índice é necessária para o MVP.
- **`attributesToRetrieve` por `return_type`** e highlighting desligado, para não trafegar dado que o agente não vai usar.

### Fora do escopo

RAG, embeddings, banco de dados, memória de conversa, login de usuário final, painel administrativo, indexação/alteração de dados no Algolia, carência, reembolso, coparticipação, autorização prévia e geolocalização. Documentos (contratos, manuais, FAQs) devem virar uma tool separada — `search_health_documents` — sem se misturar à validação determinística da rede credenciada.
