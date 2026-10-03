# Architecture — Distributed Wagering Processor

## 1. Context

A Jungle Gaming precisa de um processador financeiro distribuído para transações de
apostas (`BET → WIN | LOSS | REFUND | ROLLBACK`) vindo de múltiplos provedores, com
entrega **at-least-once**. O sistema deve permanecer correto diante de mensagens
duplicadas, fora de ordem, processadas simultaneamente por ≥3 instâncias, e de falhas
entre commit e ack/publicação.

## 2. Architecture Overview

DDD em 4 camadas:

```
presentation (HTTP controllers, SQS consumer)
       │  mesmo use case para HTTP e SQS
application (use cases: CreateWallet, ProcessWagerTransaction, ReconcileWallet, ...)
       │
domain (Money, Wallet, WagerTransaction, WalletLedgerEntry, InboxMessage, OutboxMessage, IntegrationEvents)
       │
infrastructure (MikroORM/PostgreSQL, SQS/LocalStack, outbox publisher, workers, logger, métricas)
```

Fluxo de uma transação:

```
HTTP POST /wagering/transactions ─┐
                                  ├→ ProcessWagerTransactionUseCase.execute()
SQS wager-transactions.fifo ──────┘        │
                                           ↓ em.transactional()
                            1. inbox (se veio do SQS)   ─┐
                            2. idempotency check           │ mesma
                            3. SELECT wallet FOR UPDATE    │ transação SQL
                            4. regras de negócio           │
                            5. wallet.debit/credit         │
                            6. ledger entry (append-only)  │
                            7. wager_transaction (status)  │
                            8. outbox events               ─┘
                                           ↓ COMMIT
                            ack SQS / resposta HTTP
                                           ↓ (assíncrono)
                            OutboxPublisher → integration-events.fifo
```

## 3. Domain Model

- **Money** — VO imutável sobre `Decimal` (decimal.js), escala fixa de 2 casas,
  serializado como `{ "amount": "25.00", "currency": "BRL" }`. Rejeita `NaN`,
  `Infinity`, notação científica, string vazia, >2 casas e moeda inválida.
  Operações entre moedas diferentes lançam erro.
- **Wallet** (Aggregate Root) — `balance`, `version` (inicia em 1, incrementa
  **somente quando o saldo muda`), `open()`, `rehydrate()`, `debit()`, `credit()`.
  Saldo nunca negativo (`InsufficientFundsError`).
- **WagerTransaction** — estados `PENDING → (PENDING_REFERENCE) → PROCESSED | REJECTED | FAILED`
  (terminais). `OPENING` é interno. Transições em estado terminal lançam
  `InvalidTransactionStateError`.
- **WalletLedgerEntry** — imutável; `create()` valida
  `balanceBefore ± money === balanceAfter`.
- **InboxMessage / OutboxMessage** — participam da mesma transação SQL.
- **IntegrationEvent** — envelope abstrato com `eventType`/`version` no tipo
  (`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`,
  `WagerTransactionPendingReference`); `data` carrega `MoneyProps`, nunca a instância.

Construtores `private` + factories estáticas (`create`/`open`/`from`); `rehydrate`
reconstrói estado persistido sem revalidar transições.

## 4. Money Representation

- Entrada/saída: **string decimal** com escala 2 (`"25.00"`), nunca `number`/`float`.
- Persistência: colunas `numeric(20,2)` separadas para valor e moeda — exatas no
  PostgreSQL, reidratadas como `Money`.
- Aritmética: `Decimal` com `toDecimalPlaces(2)` em cada operação.

## 5. Concurrency Strategy

**Pessimistic locking por wallet** (`LockMode.PESSIMISTIC_WRITE` → `SELECT … FOR UPDATE`),
dentro de uma transação PostgreSQL. A unidade de concorrência é `walletId`.

Por que pessimista: a operação crítica é curta (validação + débito + ledger + outbox),
o contention é por wallet (hot wallet) e não entre wallets; evita lost update com
semântica simples e sem retries de aplicação. Otimista foi descartado por exigir
retry/retry-loop em hot wallets e por complicar a idempotência concorrente.

Proteções adicionais:

- **Unique violation (`23505`)** na inserção de `wager_transactions.idempotency_key`
  (envio concorrente da mesma key) é capturada e convertida em **replay idempotente**
  (re-consulta e retorna o resultado original), não em erro 500.
- Outbox publisher e pending-reference worker fazem claim com
  `FOR UPDATE SKIP LOCKED`, permitindo múltiplos publishers/workers concorrentes.
- Nenhum lock global: cada transação trava apenas a linha da própria wallet.

Cenário obrigatório (saldo 100, duas BET 80 em paralelo): uma `PROCESSED`, uma
`REJECTED/INSUFFICIENT_FUNDS`, saldo 20, exatamente 1 débito no ledger — coberto por
teste de concorrência real.

## 6. Idempotency Strategy

- Header `Idempotency-Key` obrigatório (padrão recomendado `{providerId}:{externalTransactionId}`).
- `payloadHash` = **SHA-256 do JSON canônico** (chaves ordenadas recursivamente,
  `undefined` removido) do subconjunto de campos de negócio — o header e metadados de
  transporte não entram.
- Mesma key + mesmo hash → **replay** com o resultado original (inclusive o saldo
  observado).
- Mesma key + hash diferente → **conflito (409)**, não replay.
- A unicidade é garantida por `UNIQUE(idempotency_key)` e
  `UNIQUE(providerId, externalTransactionId)` no schema, não por cache em memória.
- A verificação ocorre dentro da transação; em caso de corrida, a violação de
  unicidade é tratada como replay (ver §5).

## 7. Inbox Pattern

Tabela `inbox_messages` com `PK (messageId, consumerName)`. Quando a entrada é SQS,
a linha é inserida **na mesma transação SQL** da alteração financeira, com
`processedAt` preenchido. Redelivery após commit encontra a linha e retorna sem
efeito colateral; ack só acontece após o commit.

## 8. Transactional Outbox

Eventos de integração são gravados em `outbox_messages` na mesma transação do evento
financeiro — **nunca publicados antes do commit**. O `OutboxPublisher`:

1. faz claim de até 10 linhas pendentes com `FOR UPDATE SKIP LOCKED` e define
   `next_attempt_at = now() + 30s` (lease);
2. publica em `integration-events.fifo` (`MessageGroupId = aggregateId`,
   `MessageDeduplicationId = eventId:attempts`);
3. marca `publishedAt`; em falha, incrementa `attempts` com backoff exponencial
   (teto 60s).

Se o processo morrer entre o commit e a publicação, a lease expira e outra instância
assume o trabalho. Publicação duplicada é segura porque o consumidor deduplica por
`messageId` (inbox).

## 9. SQS Strategy

- Filas FIFO: `wager-transactions.fifo` (com redrive para DLQ após 5 recebimentos) e
  `integration-events.fifo`. `wager-transactions-dlq.fifo` recebe o que esgotou as
  tentativas.
- `MessageGroupId = walletId` preserva ordem parcial por wallet; a garantia final,
  porém, é do banco (§5), não do broker — o broker é otimização.
- O consumer distingue: **negócio terminal** (ack imediato), **transitório** (não ack;
  visibility timeout + retry → DLQ), **permanente/malformada** (deixa expirar para DLQ).
- `SIGTERM` para o poll e aguarda mensagens em voo (`onModuleDestroy`).

## 10. Failure Handling

| Falha | Tratamento |
|---|---|
| Referência inexistente | `PENDING_REFERENCE` + evento; worker reprocessa com backoff (2ⁿs, teto 60s, 8 tentativas); esgotado → `REJECTED/REFERENCE_NOT_FOUND` + evento |
| Reversão duplicada | `REJECTED/DUPLICATE_REVERSAL` |
| Saldo insuficiente (BET) | `REJECTED/INSUFFICIENT_FUNDS` |
| Reversão geraria saldo negativo | `REJECTED/NEGATIVE_BALANCE_REVERSAL` (código distinto do anterior — situações operacionalmente diferentes) |
| Valor da reversão ≠ referência | `REJECTED/AMOUNT_MISMATCH` |
| Referência inválida (outro provider/player/round/moeda, LOSS, status não PROCESSED) | `REJECTED/REFERENCE_INVALID` |
| Moeda incompatível | `REJECTED/CURRENCY_MISMATCH` |
| Erro de infra (DB/SQS) | transação rollback; SQS não ack (retry → DLQ); outbox republishing |

## 11. Ordering

Ordenação parcial por wallet via SQS FIFO (`MessageGroupId`). Referências fora de
ordem são toleradas por design (`PENDING_REFERENCE`), então a ordenação estrita não é
requisito de correção — apenas de latência.

## 12. Database Constraints

- `wallets`: `UNIQUE(playerId, currency)`, `CHECK(balance_amount >= 0)`
- `wager_transactions`: `UNIQUE(idempotency_key)`, `UNIQUE(providerId, externalTransactionId)`,
  `CHECK(money_amount >= 0)`, índices em `status`, `walletId`, `(providerId, referenceExternalTransactionId)`
- `wallet_ledger_entries`: `UNIQUE(transactionId, walletId)` (no máximo 1 lançamento por
  transação/wallet), `CHECK(money/balance ≥ 0)`, **trigger append-only** (bloqueia
  UPDATE/DELETE), FKs para `wallets` e `wager_transactions`
- `inbox_messages`: `PK/UNIQUE(consumerName, messageId)`
- `outbox_messages`: índice em `(published_at, next_attempt_at)`

## 13. Transaction Boundaries

Uma única transação PostgreSQL contém: inbox (se SQS) + verificação de idempotência +
lock da wallet + alteração de saldo + lançamento de ledger + atualização da transação +
outbox. Commit antes de qualquer publicação SQS ou resposta ao provedor.

## 14. Observability

- Logs em **JSON** (timestamp, level, context, message) — sem payloads financeiros
  completos nem dados sensíveis;
- Métricas Prometheus em `/metrics`: `wager_transactions_total{status,kind}`,
  `wager_duplicates_detected_total`, `wager_retries_total`, `wager_dlq_messages_total`,
  `wager_lock_conflicts_total`, `wager_outbox_lag`, `wager_processing_latency_seconds`,
  `wager_reconciliation_divergences_total` + métricas padrão do runtime;
- `/health/live` (processo) e `/health/ready` (PostgreSQL `select 1` + SQS
  `ListQueues`), ambos sem autenticação.

## 15. Testing Strategy

- **Unitários**: Money, Wallet, WagerTransaction, transições, conflito de moeda.
- **Integração**: PostgreSQL e LocalStack **reais** — constraints, atomicidade,
  inbox/redelivery, publishers concorrentes.
- **Concorrência**: paralelismo real (50×, 2×80, 3 instâncias), worker morto antes
  do ack, dois publishers, referências fora de ordem, rejeição definitiva e o
  invariante final `wallet.balance == Σ(ledger)`.
- Banco de testes dedicado: `wagering_test` (`DB_NAME_TEST`).

## 16. Trade-offs

- **Pessimista vs otimista**: escolhido pessimista pela simplicidade e por hot wallets
  (§5).
- **MikroORM vs TypeORM**: MikroORM pelo Unit of Work explícito, `LockMode` tipado e
  suporte nativo a `transactional()` — requisito do desafio (preferencial).
- **Repositórios traduzem ORM ↔ domínio**: as entidades de domínio não carregam
  decorators do ORM (domínio puro); o custo é o mapeamento explícito, pago uma vez.
- **Inbox dentro da transação financeira**: garante atomicidade entre dedup e efeito,
  ao custo de reprocessar o efeito se o ack for perdido antes do commit — seguro
  porque o replay é idempotente.

## 17. Known Limitations

- **Autenticação não implementada** (não vale pontos no desafio). Desenho adotado para
  extensão: um `AuthGuard` do Nest no pipeline global, com um `ProviderIdentityPort`
  que resolve o `providerId` a partir do token OIDC emitido por um IdP externo
  (Keycloak/Zitadel) — endpoints de health permanecem abertos e mensagens da fila são
  canal interno confiável. Nenhuma tabela própria de usuários/senhas.
- Moeda única em prática (BRL); modelo multi-moeda mantido e testado.
- `payloadHash` do SQS é calculado sobre o `data` da mensagem; o `messageId` da fila
  é usado como chave da inbox.
- Métricas em memória; sem OpenTelemetry/dashboard (opcional no desafio).
- `referenceAttempts` começa a contar na primeira tentativa do worker.

## 18. Future Improvements

- Keycloak via Docker Compose + `AuthGuard` OIDC.
- OpenTelemetry traces e dashboard de métricas.
- Teste de carga (`bun run test:load`) com metodologia e percentis documentados.
- Snapshot de reconciliação periódica e alertas sobre `wager_reconciliation_divergences_total`.
