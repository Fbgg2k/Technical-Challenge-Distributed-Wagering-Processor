# Jungle Gaming — Distributed Wagering Processor

Serviço financeiro distribuído para processar transações de apostas de múltiplos provedores de jogos, com precisão monetária, idempotência persistente, ledger imutável, concorrência segura entre múltiplas instâncias e recuperação após falhas.

O desafio técnico original da Jungle Gaming está em [`README_JG.md`](./README_JG.md) e o escopo detalhado em [`ESCOPO.md`](./ESCOPO.md). As decisões de arquitetura estão em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 1. Descrição

Processa operações `BET → WIN | LOSS | REFUND | ROLLBACK` associadas a rodadas de jogos, com entrega **at-least-once** (mensagens podem chegar duplicadas, fora de ordem ou processadas simultaneamente por múltiplas instâncias).

Invariantes globais:

- não duplicar créditos nem débitos;
- não perder eventos confirmados;
- não permitir saldo negativo;
- `wallet.balance == saldo reconstruído pelo ledger` (invariante final de todos os testes).

## 2. Requisitos

- **Bun 1.x** (runtime, package manager e test runner)
- **Docker + Docker Compose** (PostgreSQL 16 e LocalStack 3.8 para SQS)
- Opcional: Keycloak (autenticação OIDC, profile `auth`)
- Opcional: `psql`/`awslocal` para inspeção manual (disponíveis dentro dos containers)

## 3. Stack

| Camada | Tecnologia |
|---|---|
| Runtime / PM / test runner | Bun 1.x |
| Linguagem | TypeScript (strict) |
| Framework | NestJS |
| Banco | PostgreSQL 16 |
| ORM | MikroORM 6 (Unit of Work, `LockMode.PESSIMISTIC_WRITE`) |
| Mensageria | AWS SQS (FIFO) via LocalStack |
| Orquestração | Docker Compose |
| Métricas | prom-client (`/metrics`) |

## 4. Arquitetura

DDD com separação `domain / application / infrastructure / presentation`. A entrada HTTP e o consumer SQS reutilizam **o mesmo use case** (`ProcessWagerTransactionUseCase`).

```
Controllers → Use Cases → Domain (Money, Wallet, WagerTransaction, LedgerEntry, Inbox, Outbox)
                          ↓
                    PostgreSQL (locks, constraints, triggers)
                          ↓
            SQS (inbox dedup + transactional outbox)
```

## 5. Pré-requisitos e setup

```bash
# 1. Instalar dependências
bun install

# 2. Subir PostgreSQL e LocalStack (cria as filas SQS automaticamente)
docker compose up -d postgres localstack

# 3. Rodar migrations
bun run migration:up

# 4. Rodar a aplicação (consumer SQS e workers habilitados via .env)
cp .env.example .env
bun run start
```

A aplicação sobe em `http://localhost:3000`.

## 6. Docker

```bash
docker compose up -d            # postgres + localstack + app
docker compose down             # para tudo
docker compose logs -f app      # logs da aplicação
```

O serviço `app` depende de `postgres` e `localstack` estarem saudáveis. As filas
`wager-transactions.fifo`, `wager-transactions-dlq.fifo` (com redrive após 5 recebimentos)
e `integration-events.fifo` são criadas no startup do LocalStack
(`docker/localstack/setup-queues.sh`).

## 7. Variáveis de ambiente

Cópia em [`.env.example`](./.env.example):

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta da API |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | localhost/5432/wagering | PostgreSQL |
| `SQS_ENDPOINT` | `http://localhost:4566` | LocalStack |
| `AWS_REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY` | us-east-1/test | Credenciais do SQS local |
| `SQS_WAGER_QUEUE_URL` | …/wager-transactions.fifo | Fila de entrada |
| `SQS_EVENTS_QUEUE_URL` | …/integration-events.fifo | Fila de eventos (outbox) |
| `SQS_CONSUMER_ENABLED` | `true` | Liga o consumer de wager-transactions |
| `OUTBOX_PUBLISHER_ENABLED` | `true` | Liga o publisher da outbox |
| `PENDING_REFERENCE_WORKER_ENABLED` | `true` | Liga o worker de referências fora de ordem |

## 8. Banco de dados

```bash
bun run migration:create   # gera migration a partir das entidades MikroORM
bun run migration:up       # aplica
bun run migration:down     # reverte a última
```

Tabelas: `wallets`, `wager_transactions`, `wallet_ledger_entries`, `inbox_messages`, `outbox_messages`.
Constraints de unicidade, checks de não-negatividade, FKs e trigger **append-only** no ledger
estão no schema (`src/infrastructure/database/migrations/`).

## 9. LocalStack / SQS

Filas criadas automaticamente pelo Compose. Inspeção manual:

```bash
docker exec jungle_gaming-localstack-1 awslocal sqs list-queues
docker exec jungle_gaming-localstack-1 awslocal sqs get-queue-attributes \
  --queue-url http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/wager-transactions.fifo \
  --attribute-names ApproximateNumberOfMessages
```

## 10. Migrations

Versionadas e reversíveis (`up`/`down`). A migration inicial cria tipos enum, tabelas,
constraints, índices, FKs e a trigger que proíbe UPDATE/DELETE em `wallet_ledger_entries`.

## 11. Execução

```bash
bun run start            # produção (dist)
bun run start:dev        # watch mode
bun run build            # compila TypeScript
bun run lint             # ESLint
bun run format           # Prettier
```

## 12. API

Autenticação: OIDC via JWKS (Keycloak/Zitadel), **desabilitada por padrão**
(`AUTH_ENABLED=false`). Ativação e comandos na seção abaixo. Endpoints de
health e métricas ficam abertos.

| Método | Endpoint | Descrição |
|---|---|---|
| `POST` | `/wallets` | Cria wallet (OPENING + ledger na mesma transação) |
| `GET` | `/wallets/:walletId` | Consulta wallet |
| `GET` | `/wallets/:walletId/ledger?cursor=&limit=` | Ledger com cursor estável |
| `POST` | `/wallets/:walletId/reconciliation` | Compara saldo materializado vs ledger (divergências logadas + métrica) |
| `POST` | `/wagering/transactions` | Submete transação (header `Idempotency-Key` obrigatório) |
| `GET` | `/wagering/transactions/:transactionId` | Consulta transação |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta por provedor |
| `GET` | `/health/live` | Liveness (sem auth) |
| `GET` | `/health/ready` | Readiness: PostgreSQL + SQS (sem auth) |
| `GET` | `/metrics` | Métricas Prometheus |

### Autenticação (OIDC, opcional)

Por padrão `AUTH_ENABLED=false` (guard atua como no-op — extensão explícita,
documentada em `ARCHITECTURE.md`). Para ativar com Keycloak:

```bash
docker compose --profile auth up -d keycloak
bun scripts/setup-keycloak-realm.ts
# .env: AUTH_ENABLED=true, AUTH_ISSUER=http://localhost:8080/realms/jungle,
# AUTH_JWKS_URL=http://localhost:8080/realms/jungle/protocol/openid-connect/certs
bun run start
```

O script cria o realm `jungle`, o client `jungle-gaming` (direct access
grants) e o usuário de teste `player`/`player`, e neutraliza as required
actions (`VERIFY_PROFILE` etc.) que bloqueiam o direct grant no Keycloak 26.

Todos os endpoints (exceto `/health/*` e `/metrics`, marcados com `@Public()`)
exigem `Authorization: Bearer <jwt>` válido contra o issuer configurado
(verificação assimétrica via JWKS, cache de 5 min, issuer e audience
validados). Token de teste:

```bash
TOKEN=$(wget -qO- --post-data="username=player&password=player&grant_type=password&client_id=jungle-gaming" \
  http://localhost:8080/realms/jungle/protocol/openid-connect/token | sed 's/.*"access_token":"\([^"]*\)".*/\1/')
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/wallets -X POST ...
```

## 13. Teste de carga

```bash
LOAD_DURATION_MS=30000 LOAD_CONCURRENCY=50 bun run test:load
```

Dispara `POST /wagering/transactions` concorrentes por N segundos e imprime
JSON com throughput, p50/p95/p99, taxa de erro, conflitos de concorrência,
outbox lag e a reconciliação final. Exemplo real (hot wallet, 20 workers,
10s): **70 req/s**, p50 188 ms, p95 760 ms, p99 1982 ms, 0 erros,
reconciliação consistente — a serialização por `FOR UPDATE` na mesma wallet
é o gargalo esperado em hot wallet (unidade de concorrência = `walletId`).

### Exemplo — criar wallet

```bash
curl -X POST localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'
```

### Exemplo — aposta idempotente

```bash
curl -X POST localhost:3000/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-a:transaction-123' \
  -d '{
    "providerId":"provider-a",
    "externalTransactionId":"transaction-123",
    "playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId":"<wallet-id>",
    "roundId":"round-987",
    "gameId":"fortune-chimp",
    "kind":"BET",
    "money":{"amount":"25.00","currency":"BRL"}
  }'
```

Respostas: `201` criação, `200` sucesso, `400` payload inválido, `404` não encontrado,
`409` conflito de idempotência, `503` não pronto.

## 13. SQS

Mensagem `WagerTransactionRequested` (ver `README_JG.md` §10). O consumer:

- reutiliza o mesmo use case da HTTP;
- deduplica via **inbox persistente** `(consumerName, messageId)` na mesma transação SQL;
- faz **ack somente após o commit**;
- erros de negócio (terminais) → ack; transitórios → retry (visibility timeout) → **DLQ** após 5 recebimentos;
- `SIGTERM` conclui mensagens em voo antes de parar.

## 14. Testes

```bash
bun test                                   # tudo (33 testes)
bun run test:unit                          # unitários
bun run test:integration                   # integração (PostgreSQL + LocalStack reais)
bun run test:concurrency                   # concorrência
bun run test:e2e                           # cenários obrigatórios
```

Os testes de integração/concorrência usam o banco `wagering_test` (criado via
`docker exec jungle_gaming-postgres-1 psql -U wagering -d postgres -c "create database wagering_test;"`)
e rodam contra PostgreSQL e LocalStack reais — **sem mocks de banco ou fila**.

### Cenários cobertos

- mesma aposta 50× em paralelo → um único débito;
- duas apostas de 80 em saldo 100 → uma `PROCESSED`, uma `REJECTED`, saldo 20, 1 débito;
- wallets distintas em paralelo; 3 instâncias simultâneas;
- worker morto após commit antes do ack (redelivery sem efeito duplicado);
- dois publishers sobre a mesma outbox (`SKIP LOCKED`);
- `ROLLBACK`/`REFUND` antes da referência (`PENDING_REFERENCE` + worker de retry);
- rejeição definitiva após esgotar tentativas (`REFERENCE_NOT_FOUND`);
- invariantes: `wallet.balance == Σ(ledger)` para todas as wallets.

## 15. Observabilidade

- **Logs JSON** estruturados (timestamp, level, context, message) — sem payloads financeiros completos;
- **Métricas** em `/metrics`: transações por status, duplicatas, retries, DLQ, lock conflicts, outbox lag, latência;
- **Health checks** separados: `/health/live` e `/health/ready`.

## 16. Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `EADDRINUSE` na porta 3000 | instância anterior rodando | `pkill -f "nest start"` |
| `Unable to acquire a connection` | Postgres fora do ar | `docker compose up -d postgres` |
| Filas SQS não criadas | LocalStack reiniciou sem o script de init | `docker compose up -d --force-recreate localstack` |
| `migration:create` diz "no changes" | snapshot stale | `rm -rf src/infrastructure/database/migrations && bun run migration:create` |
| LocalStack exige `LOCALSTACK_AUTH_TOKEN` | imagem `latest` (paga) | use `localstack/localstack:3.8` (já configurado) |

## 17. Limitações

- Autenticação OIDC implementada mas desabilitada por padrão (`AUTH_ENABLED=false`);
- Moeda única (BRL) em prática, modelo preparado para multi-moeda;
- Métricas em memória (sem scrape remoto persistente);
- OpenTelemetry/dashboard opcional não implementado.

## 18. Comandos rápidos

```bash
bun install
docker compose up -d postgres localstack
docker exec jungle_gaming-postgres-1 psql -U wagering -d postgres -c "create database wagering_test;"
bun run migration:up
DB_NAME=wagering_test bun run migration:up
bun run start          # outra aba
bun test
```
