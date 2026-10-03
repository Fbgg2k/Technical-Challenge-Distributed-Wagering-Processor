# ESCOPO TÉCNICO — JUNGLE GAMING
## Distributed Wagering Processor

> Escopo de implementação elaborado a partir do `README.md` do desafio técnico da Jungle Gaming.

---

# 1. Objetivo

Construir um serviço financeiro distribuído para processar transações de apostas recebidas de múltiplos provedores de jogos.

O sistema deve garantir:

- precisão monetária;
- idempotência persistente;
- consistência entre saldo materializado e ledger;
- processamento assíncrono;
- tolerância a mensagens duplicadas;
- tolerância a mensagens fora de ordem;
- concorrência entre múltiplas instâncias;
- recuperação após falhas;
- rastreabilidade;
- observabilidade.

O sistema deve permanecer correto quando mensagens forem duplicadas, entregues fora de ordem ou processadas simultaneamente.

---

# 2. Critérios centrais do desafio

O desafio não é um CRUD convencional. Os principais pontos de avaliação são:

1. Correção financeira.
2. Concorrência entre múltiplas instâncias.
3. Idempotência persistente.
4. Consistência entre saldo e ledger.
5. Processamento assíncrono.
6. Recuperação após falhas.
7. Clareza das decisões técnicas.
8. Testes com PostgreSQL e SQS reais em containers.

---

# 3. Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript |
| Runtime / package manager / test runner | Bun 1.x |
| Framework | NestJS |
| Banco | PostgreSQL |
| ORM | MikroORM |
| Mensageria | AWS SQS |
| Ambiente local de SQS | LocalStack ou MiniStack |
| Orquestração | Docker Compose |
| API | REST |
| Arquitetura | DDD + separação Domain / Application / Infrastructure / Presentation |
| Persistência de idempotência | PostgreSQL |
| Concorrência | Transações e locking no PostgreSQL |
| Eventos | Transactional Outbox |
| Mensagens recebidas | Inbox |
| Observabilidade | Logs estruturados + métricas + health checks |
| Documentação | README.md + ARCHITECTURE.md |

## 3.1 Restrições tecnológicas

- Não utilizar Prisma.
- Não utilizar `number`, `float` ou `double` para dinheiro.
- Não utilizar cache em memória como garantia de idempotência.
- Não depender apenas de SQS FIFO para consistência.
- Não publicar eventos antes do commit financeiro.
- Não sobrescrever ou excluir lançamentos do ledger.
- Não utilizar lock global compartilhado por todas as wallets.
- Não implementar saldo como `read → calculate → update` sem controle de concorrência.
- A solução deve funcionar com múltiplas instâncias.
- Garantias de unicidade, imutabilidade e não-negatividade devem ser aplicadas no schema do banco.

---

# 4. Arquitetura proposta

```text
                    ┌─────────────────────┐
                    │      Clientes       │
                    │ Provider / API      │
                    └──────────┬──────────┘
                               │
                               ▼
                     ┌──────────────────┐
                     │   NestJS API     │
                     │ Controllers      │
                     │ DTOs / Guards    │
                     └────────┬─────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Application Layer  │
                    │                     │
                    │ Use Cases           │
                    │ CreateWallet        │
                    │ ProcessTransaction  │
                    │ ReconcileWallet     │
                    └──────────┬──────────┘
                               │
                               ▼
                     ┌──────────────────┐
                     │  Domain Layer    │
                     │                  │
                     │ Money            │
                     │ Wallet           │
                     │ WagerTransaction │
                     │ LedgerEntry      │
                     │ Inbox            │
                     │ Outbox           │
                     └────────┬─────────┘
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
       ┌─────────────────┐        ┌─────────────────┐
       │ PostgreSQL      │        │ Infrastructure  │
       │                 │        │                 │
       │ Wallet          │        │ SQS             │
       │ Transactions    │        │ LocalStack      │
       │ Ledger          │        │ Consumers       │
       │ Inbox           │        │ Publishers      │
       │ Outbox          │        │ Workers         │
       └─────────────────┘        └─────────────────┘
```

Princípio importante: a entrada HTTP e o consumidor SQS devem reutilizar o mesmo caso de uso de processamento da transação.

---

# 5. Estrutura de diretórios sugerida

```text
jungle-wagering-processor/
│
├── src/
│   ├── domain/
│   │   ├── wallet/
│   │   │   ├── entities/
│   │   │   │   └── wallet.entity.ts
│   │   │   ├── value-objects/
│   │   │   │   └── money.vo.ts
│   │   │   └── repositories/
│   │   │       └── wallet.repository.ts
│   │   │
│   │   ├── wagering/
│   │   │   ├── entities/
│   │   │   │   └── wager-transaction.entity.ts
│   │   │   ├── enums/
│   │   │   │   ├── wager-kind.enum.ts
│   │   │   │   └── transaction-status.enum.ts
│   │   │   └── repositories/
│   │   │
│   │   ├── ledger/
│   │   │   ├── entities/
│   │   │   │   └── ledger-entry.entity.ts
│   │   │   └── repositories/
│   │   │
│   │   ├── messaging/
│   │   │   ├── entities/
│   │   │   │   ├── inbox-message.entity.ts
│   │   │   │   └── outbox-message.entity.ts
│   │   │   └── events/
│   │   │
│   │   └── shared/
│   │       └── errors/
│   │
│   ├── application/
│   │   ├── wallets/
│   │   │   ├── create-wallet.use-case.ts
│   │   │   ├── get-wallet.use-case.ts
│   │   │   └── reconcile-wallet.use-case.ts
│   │   └── wagering/
│   │       └── process-wager-transaction.use-case.ts
│   │
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── mikro-orm.config.ts
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   ├── messaging/
│   │   │   ├── sqs/
│   │   │   ├── inbox/
│   │   │   └── outbox/
│   │   └── observability/
│   │       ├── logger/
│   │       └── metrics/
│   │
│   ├── presentation/
│   │   ├── http/
│   │   │   ├── wallets/
│   │   │   ├── wagering/
│   │   │   └── health/
│   │   └── messaging/
│   │       └── consumers/
│   │
│   ├── app.module.ts
│   └── main.ts
│
├── test/
│   ├── unit/
│   ├── integration/
│   ├── concurrency/
│   └── e2e/
│
├── docker/
│   ├── postgres/
│   └── localstack/
│
├── docker-compose.yml
├── Dockerfile
├── package.json
├── bun.lock
├── tsconfig.json
├── README.md
├── ARCHITECTURE.md
└── .env.example
```

---

# 6. Modelo de domínio

## 6.1 Money

`Money` deve ser um Value Object imutável.

Representação externa:

```json
{
  "amount": "25.00",
  "currency": "BRL"
}
```

Requisitos:

- valor recebido e serializado como string decimal;
- escala fixa de 2 casas;
- moeda ISO-4217;
- operações entre moedas diferentes devem falhar;
- rejeitar `NaN`;
- rejeitar `Infinity`;
- rejeitar notação científica;
- rejeitar string vazia;
- rejeitar mais de 2 casas decimais;
- rejeitar valores negativos nos contratos de entrada;
- domínio não deve depender de tipos monetários do ORM.

Operações:

```text
add()
subtract()
negate()
isZero()
isPositive()
isNegative()
isLessThan()
equals()
toJSON()
toString()
```

Para reduzir escopo, pode ser utilizada apenas BRL nas operações, mantendo o modelo preparado para múltiplas moedas.

---

# 7. Wallet

A `Wallet` será o Aggregate Root.

A entidade deverá conter:

```text
id
playerId
currency
balance
version
createdAt
updatedAt
```

Invariantes:

- no máximo uma wallet por `playerId + currency`;
- saldo nunca pode ser negativo;
- toda alteração de saldo deve possuir lançamento correspondente;
- operações concorrentes não podem causar lost update;
- moeda da operação deve ser igual à moeda da wallet;
- `version` inicia em 1;
- `version` incrementa somente quando o saldo muda.

Métodos principais:

```text
open()
rehydrate()
debit()
credit()
```

---

# 8. WagerTransaction

Tipos:

```text
OPENING
BET
WIN
LOSS
REFUND
ROLLBACK
```

Status:

```text
PENDING
PENDING_REFERENCE
PROCESSED
REJECTED
FAILED
```

A transação deverá possuir:

```text
id
providerId
externalTransactionId
idempotencyKey
payloadHash
walletId
playerId
roundId
gameId
kind
money
referenceExternalTransactionId
referenceTransactionId
status
failureCode
processedAt
createdAt
```

`PROCESSED`, `REJECTED` e `FAILED` são estados terminais.

`OPENING` é interno e não pode ser submetido pela API nem pela fila.

A mesma idempotency key com payload diferente representa conflito.

---

# 9. Ledger

`WalletLedgerEntry` deve ser imutável.

Campos:

```text
id
walletId
transactionId
direction
money
balanceBefore
balanceAfter
createdAt
```

Direções:

```text
DEBIT
CREDIT
```

A criação do lançamento deve validar:

```text
balanceBefore ± amount == balanceAfter
```

Regras:

- uma transação financeira produz no máximo um lançamento por wallet;
- `LOSS` não produz lançamento;
- transação `REJECTED` não produz lançamento;
- lançamentos nunca devem ser atualizados ou excluídos.

---

# 10. Regras de negócio

| Operação | Efeito no saldo | Ledger | Regra |
|---|---:|---|---|
| BET | Débito | DEBIT | Rejeitar se saldo insuficiente |
| WIN | Crédito | CREDIT | Pode referenciar BET da mesma rodada |
| LOSS | Nenhum | Nenhum | Registra resultado |
| REFUND | Crédito | CREDIT | Reverte BET processada uma única vez |
| ROLLBACK | Inverso da referência | Invertido | Reverte transação processada uma única vez |

Regras adicionais:

1. `REFUND` e `ROLLBACK` exigem referência externa.
2. A referência é resolvida por `providerId + referenceExternalTransactionId`.
3. A referência deve pertencer ao mesmo provider, player, wallet, moeda e rodada.
4. `REFUND` só pode referenciar `BET`.
5. `ROLLBACK` pode referenciar `BET`, `WIN` ou `REFUND`.
6. Uma referência não pode ser revertida duas vezes pelo mesmo tipo.
7. O valor da reversão deve ser igual ao valor da referência.
8. Transação rejeitada não altera saldo.
9. Replay deve retornar o resultado original.
10. Referência inexistente deve gerar `PENDING_REFERENCE`.
11. Reversão que causaria saldo negativo deve ser rejeitada com `failureCode` específico.

---

# 11. Estratégia de concorrência

A unidade de concorrência é a `walletId`.

Estratégia recomendada:

**Pessimistic Locking por wallet dentro da transação PostgreSQL.**

Fluxo conceitual:

```text
BEGIN
    ↓
SELECT wallet FOR UPDATE
    ↓
validar operação
    ↓
alterar saldo
    ↓
criar ledger
    ↓
criar/atualizar transaction
    ↓
criar outbox
    ↓
COMMIT
```

Isso evita que duas apostas simultâneas utilizem o mesmo saldo.

### Cenário obrigatório

Saldo:

```text
100.00 BRL
```

Duas apostas simultâneas:

```text
BET 80.00
BET 80.00
```

Resultado esperado:

```text
BET A → PROCESSED
BET B → REJECTED
saldo → 20.00 BRL
ledger → exatamente 1 débito
```

---

# 12. Idempotência

O header é obrigatório:

```http
Idempotency-Key: provider-a:transaction-123
```

Estratégia:

1. receber request;
2. gerar hash do JSON canônico;
3. consultar a chave persistida;
4. se inexistente, processar;
5. se existente e hash igual, retornar resultado original;
6. se existente e hash diferente, retornar conflito.

Exemplo:

```text
Key: provider-a:123
Hash: ABC
```

Repetição:

```text
Key: provider-a:123
Hash: ABC
→ Replay
```

Payload diferente:

```text
Key: provider-a:123
Hash: XYZ
→ Conflict
```

A idempotência não deve depender de memória da aplicação.

---

# 13. API HTTP

## Criar wallet

```http
POST /wallets
```

Payload:

```json
{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": {
    "amount": "1000.00",
    "currency": "BRL"
  }
}
```

Se o saldo inicial for maior que zero, criar uma transação interna `OPENING` e seu lançamento `CREDIT` na mesma transação SQL.

---

## Consultar wallet

```http
GET /wallets/:walletId
```

---

## Consultar ledger

```http
GET /wallets/:walletId/ledger?cursor=...&limit=50
```

Utilizar cursor estável e opaco.

---

## Consultar transação

```http
GET /wagering/transactions/:transactionId
```

---

## Consultar transação pelo provider

```http
GET /providers/:providerId/wagering/transactions/:externalTransactionId
```

---

## Submeter transação

```http
POST /wagering/transactions
Idempotency-Key: provider-a:transaction-123
```

Exemplo:

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": {
    "amount": "25.00",
    "currency": "BRL"
  }
}
```

Resposta esperada:

```json
{
  "transactionId": "0192f298-345e-7e38-af88-e43f851a819d",
  "status": "PROCESSED",
  "balance": {
    "amount": "975.00",
    "currency": "BRL"
  },
  "idempotentReplay": false
}
```

---

# 14. Reconciliação

Endpoint:

```http
POST /wallets/:walletId/reconciliation
```

Deve comparar:

```text
saldo armazenado
vs.
saldo reconstruído pelo ledger
```

Resposta:

```json
{
  "walletId": "...",
  "storedBalance": {
    "amount": "975.00",
    "currency": "BRL"
  },
  "calculatedBalance": {
    "amount": "975.00",
    "currency": "BRL"
  },
  "difference": {
    "amount": "0.00",
    "currency": "BRL"
  },
  "consistent": true,
  "checkedEntries": 42
}
```

Divergências não devem ser corrigidas silenciosamente.

---

# 15. Health Checks

```http
GET /health/live
GET /health/ready
```

`/health/live`:

- confirma que o processo está vivo.

`/health/ready`:

- verifica PostgreSQL;
- verifica SQS.

Ambos devem permanecer sem autenticação.

---

# 16. SQS

Filas:

```text
wager-transactions.fifo
wager-transactions-dlq.fifo
```

Mensagem:

```json
{
  "messageId": "msg-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "...",
    "walletId": "...",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": {
      "amount": "25.00",
      "currency": "BRL"
    }
  }
}
```

Consumer:

1. recebe mensagem;
2. registra Inbox;
3. chama o mesmo use case utilizado pela API;
4. processa transação;
5. realiza commit;
6. somente então confirma/acknowledge;
7. erros transitórios devem sofrer retry;
8. erros permanentes devem ir para DLQ;
9. redelivery não pode duplicar efeitos;
10. `SIGTERM` deve permitir concluir mensagens ou devolver a visibilidade.

---

# 17. Inbox

A Inbox deve persistir:

```text
messageId
consumerName
payloadHash
receivedAt
processedAt
```

Constraint recomendada:

```text
UNIQUE(consumerName, messageId)
```

Objetivo:

```text
SQS entrega
      ↓
Consumer
      ↓
Inbox
      ↓
processamento
      ↓
commit
      ↓
ACK
```

Se houver redelivery após o commit, a mensagem será reconhecida como já processada.

---

# 18. Transactional Outbox

A alteração financeira e o evento devem ser persistidos atomicamente.

Dentro da mesma transação:

```text
BEGIN
  ↓
transaction
  ↓
wallet
  ↓
ledger
  ↓
inbox (quando SQS)
  ↓
outbox
  ↓
COMMIT
```

Depois do commit:

```text
Outbox Worker
      ↓
SQS
```

Cenário obrigatório:

```text
PostgreSQL COMMIT
      ↓
processo morre
      ↓
evento ainda está na Outbox
      ↓
outra instância assume
      ↓
publica evento
```

---

# 19. Eventos

Eventos mínimos:

```text
WagerTransactionProcessed
WagerTransactionRejected
WalletBalanceChanged
WagerTransactionPendingReference
```

Envelope:

```text
eventId
eventType
aggregateId
correlationId
causationId
occurredAt
version
data
```

`Money` deve ser serializado como:

```json
{
  "amount": "25.00",
  "currency": "BRL"
}
```

Nunca serializar a instância interna do Value Object.

---

# 20. Referências fora de ordem

`REFUND` e `ROLLBACK` podem chegar antes da operação referenciada.

Fluxo:

```text
REFUND
   ↓
referência não encontrada
   ↓
PENDING_REFERENCE
   ↓
persistência
   ↓
worker agendado
   ↓
retry com backoff
```

O worker deve possuir:

- intervalo/backoff;
- limite de tentativas ou TTL;
- rejeição definitiva após esgotamento;
- `failureCode` específico;
- evento de integração correspondente.

---

# 21. Observabilidade

## Logs

Utilizar JSON estruturado com:

```text
correlationId
messageId
transactionId
walletId
providerId
```

Não registrar payload financeiro completo ou dados sensíveis.

## Métricas

Mínimo:

```text
transactions_by_status
duplicates_detected
retries
dlq_messages
lock_conflicts
outbox_lag
processing_latency
```

OpenTelemetry e dashboard são opcionais.

---

# 22. Testes

## 22.1 Testes unitários

Implementar:

- [x] operações do `Money` — `test/unit/money.test.ts` (add/subtract/negate, comparações, imutabilidade);
- [x] escala monetária — `test/unit/money.test.ts` ("25.0" e "25" normalizam para "25.00");
- [x] entradas inválidas — `test/unit/money.test.ts` (NaN, Infinity, notação científica, vazio, >2 casas, string inválida, moeda minúscula);
- [x] invariantes da Wallet — `test/unit/wallet.test.ts` (version inicia em 1, incrementa só quando o saldo muda, saldo nunca negativo, rehydrate);
- [x] BET — `test/unit/wager-transaction.test.ts` (afeta saldo, direção DEBIT);
- [x] WIN — `test/unit/wager-transaction.test.ts` (afeta saldo, ROLLBACK inverte para DEBIT);
- [x] LOSS — `test/unit/wager-transaction.test.ts` (não afeta saldo, sem ledger);
- [x] REFUND — `test/unit/wager-transaction.test.ts` (exige referência, gera CREDIT);
- [x] ROLLBACK — `test/unit/wager-transaction.test.ts` (exige referência, inverte direção da referência);
- [x] conflito de moeda — `test/unit/money.test.ts` + `test/unit/wallet.test.ts` (operações entre moedas diferentes lançam erro);
- [x] idempotency key com payload divergente — `test/integration/database-and-outbox.test.ts` (mesma chave + valor diferente → `ConflictException`, saldo e ledger inalterados) + `matchesPayload` unitário;
- [x] transições de estado — `test/unit/wager-transaction.test.ts` (PROCESSED/REJECTED/FAILED terminais, OPENING bloqueado, PENDING inicial).

## 22.2 Testes de integração

Utilizar PostgreSQL e LocalStack reais em containers.

Testar:

- [x] migrations — `test/integration/migrations.test.ts` (up() cria schema completo em banco isolado; down() reverte migration por migration; up() restaura) + preload `test/helpers/setup-schema.ts` (suíte auto-contida: banco vazio → migrations aplicadas automaticamente);
- [x] constraints — `test/integration/database-and-outbox.test.ts` ("constraints: saldo negativo violado, ledger append-only, wallet duplicada");
- [x] atomicidade — `test/integration/database-and-outbox.test.ts` ("atomicidade: wallet + tx + ledger + inbox + outbox consistentes");
- [x] wallet + ledger — invariante `wallet.balance == Σ(ledger)` verificado no teste de atomicidade e no cenário final;
- [x] inbox — `test/integration/database-and-outbox.test.ts` ("inbox: redelivery com mesmo messageId não duplica efeito");
- [x] outbox — `test/integration/database-and-outbox.test.ts` (eventos persistidos na mesma transação) + `test/integration/sqs-dlq-retry-recovery.test.ts`;
- [x] publishers concorrentes — `test/integration/database-and-outbox.test.ts` ("dois publishers concorrentes não publicam em duplicidade", claim com `FOR UPDATE SKIP LOCKED`);
- [x] retry — `test/integration/sqs-dlq-retry-recovery.test.ts` ("outbox retry: falha no SQS incrementa attempts e agenda backoff exponencial") + `retryPendingReference` em `test/concurrency/required-scenarios.test.ts`;
- [x] DLQ — `test/integration/sqs-dlq-retry-recovery.test.ts` ("DLQ: RedrivePolicy configurada (maxReceiveCount=5 → DLQ ARN) e consumer não deleta mensagem malformada" — comportamento real do consumer contra SQS; o redrive automático é nativo da AWS SQS, o LocalStack local não o implementa para FIFO);
- [x] redelivery — `test/integration/database-and-outbox.test.ts` (inbox) + `test/concurrency/required-scenarios.test.ts` ("REFUND antes da referência e worker morto antes do ack");
- [x] recuperação após reinicialização — `test/integration/sqs-dlq-retry-recovery.test.ts` ("recuperação: evento pendente na outbox (crash pós-commit) é publicado por nova instância").

## 22.3 Testes de concorrência

- [x] mesma aposta enviada 50 vezes em paralelo — `test/concurrency/concurrent-bets.test.ts` ("mesma aposta enviada 50 vezes em paralelo → um único débito");
- [x] duas apostas concorrentes sobre o mesmo saldo — `test/concurrency/concurrent-bets.test.ts` ("duas apostas de 80 em saldo 100 → exatamente uma vence");
- [x] wallets diferentes processadas em paralelo — `test/concurrency/concurrent-bets.test.ts` ("wallets diferentes processadas em paralelo preservam saldos independentes");
- [x] três ou mais instâncias simultâneas — `test/concurrency/required-scenarios.test.ts` ("3 instâncias simultâneas sobre a mesma wallet");
- [x] worker morto após commit e antes do ACK — `test/concurrency/required-scenarios.test.ts` ("REFUND antes da referência e worker morto antes do ack (redelivery)" — inbox persistida + redelivery idempotente);
- [x] dois publishers sobre a mesma outbox — `test/integration/database-and-outbox.test.ts` ("dois publishers concorrentes não publicam em duplicidade", claim com `FOR UPDATE SKIP LOCKED`);
- [x] ROLLBACK antes da referência — `test/concurrency/required-scenarios.test.ts` ("ROLLBACK entregue antes da referência (PENDING_REFERENCE)" + retry do worker);
- [x] REFUND antes da referência — `test/concurrency/required-scenarios.test.ts` ("REFUND antes da referência e worker morto antes do ack");
- [x] reinicialização do serviço — `test/concurrency/required-scenarios.test.ts` ("reinicialização do serviço: estado persistido e processamento retomado" — ORM fechado e reaberto no meio do teste; saldo e ledger intactos; nova transação processada na nova instância);
- [x] verificação final de consistência — `test/concurrency/required-scenarios.test.ts` ("consistência final: wallet.balance == saldo reconstruído pelo ledger" em todas as wallets do banco de testes).

Invariante:

```text
wallet.balance == saldo reconstruído pelo ledger
```

---

# 23. Estratégia de implementação

## Fase 01 — Bootstrap

- [ ] criar projeto Bun;
- [ ] configurar NestJS;
- [ ] configurar TypeScript strict;
- [ ] configurar ESLint;
- [ ] configurar Prettier;
- [ ] configurar `.env`;
- [ ] criar Dockerfile;
- [ ] criar Docker Compose;
- [ ] configurar PostgreSQL;
- [ ] configurar LocalStack;
- [ ] configurar MikroORM.

## Fase 02 — Domain

- [ ] Money;
- [ ] Wallet;
- [ ] WagerTransaction;
- [ ] WalletLedgerEntry;
- [ ] InboxMessage;
- [ ] OutboxMessage;
- [ ] enums;
- [ ] domain errors.

## Fase 03 — Database

- [ ] tabela wallets;
- [ ] tabela wager_transactions;
- [ ] tabela wallet_ledger_entries;
- [ ] tabela inbox_messages;
- [ ] tabela outbox_messages;
- [ ] foreign keys;
- [ ] unique constraints;
- [ ] índices;
- [ ] migrations reversíveis.

## Fase 04 — Wallet

- [ ] POST `/wallets`;
- [ ] GET wallet;
- [ ] OPENING;
- [ ] ledger inicial;
- [ ] version;
- [ ] constraint de wallet única.

## Fase 05 — Transactions

- [ ] POST `/wagering/transactions`;
- [ ] payload hash;
- [ ] idempotência;
- [ ] BET;
- [ ] WIN;
- [ ] LOSS;
- [ ] REFUND;
- [ ] ROLLBACK;
- [ ] códigos de falha.

## Fase 06 — Concorrência

- [ ] transação SQL;
- [ ] lock por wallet;
- [ ] proteção contra lost update;
- [ ] retry;
- [ ] testes paralelos.

## Fase 07 — SQS

- [ ] FIFO;
- [ ] DLQ;
- [ ] producer;
- [ ] consumer;
- [ ] inbox;
- [ ] retry;
- [ ] visibility timeout;
- [ ] graceful shutdown.

## Fase 08 — Outbox

- [ ] eventos;
- [ ] persistência transacional;
- [ ] publisher worker;
- [ ] retry;
- [ ] backoff;
- [ ] múltiplos publishers.

## Fase 09 — Pending Reference

- [ ] PENDING_REFERENCE;
- [ ] worker;
- [ ] exponential backoff;
- [ ] max attempts;
- [ ] rejeição definitiva.

## Fase 10 — Observabilidade

- [ ] logs JSON;
- [ ] correlation ID;
- [ ] métricas;
- [ ] liveness;
- [ ] readiness.

## Fase 11 — Testes

- [ ] unitários;
- [ ] integração;
- [ ] E2E;
- [ ] concorrência;
- [ ] crash recovery;
- [ ] SQS redelivery;
- [ ] outbox race;
- [ ] restart.

## Fase 12 — Documentação

- [ ] README.md;
- [ ] ARCHITECTURE.md;
- [ ] setup;
- [ ] comandos;
- [ ] variáveis de ambiente;
- [ ] API;
- [ ] SQS;
- [ ] decisões técnicas;
- [ ] trade-offs;
- [ ] limitações.

---

# 24. Autenticação

Autenticação não é prioridade de pontuação.

Se implementada, a recomendação é integrar um Identity Provider externo, como Keycloak ou equivalente.

Não implementar autenticação artesanal com tabela própria de usuários e senha.

Se não houver tempo para implementar:

- [ ] documentar a decisão em `ARCHITECTURE.md`;
- [ ] criar ponto de extensão;
- [ ] prever `AuthGuard`;
- [ ] prever `ProviderIdentityPort`.

Health checks devem permanecer abertos.

---

# 25. README.md

O README final deve conter:

```text
1. Descrição
2. Requisitos
3. Stack
4. Arquitetura
5. Pré-requisitos
6. Docker
7. Variáveis de ambiente
8. Banco
9. LocalStack
10. Migrations
11. Execução
12. API
13. SQS
14. Testes
15. Testes de concorrência
16. Observabilidade
17. Troubleshooting
18. Limitações
```

---

# 26. ARCHITECTURE.md

Estrutura recomendada:

```markdown
# Architecture

## 1. Context

## 2. Architecture Overview

## 3. Domain Model

## 4. Money Representation

## 5. Concurrency Strategy

## 6. Idempotency Strategy

## 7. Inbox Pattern

## 8. Transactional Outbox

## 9. SQS Strategy

## 10. Failure Handling

## 11. Ordering

## 12. Database Constraints

## 13. Transaction Boundaries

## 14. Observability

## 15. Testing Strategy

## 16. Trade-offs

## 17. Known Limitations

## 18. Future Improvements
```

---

# 27. CHECK-IN FINAL

## Infraestrutura

- [x] `docker compose up` funciona — PostgreSQL 16, LocalStack 3.8 e Keycloak 26 (profile `auth`) rodando;
- [x] PostgreSQL inicia;
- [x] LocalStack inicia;
- [x] SQS é criado — `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `integration-events.fifo` (setup-queues.sh);
- [x] DLQ é criada — com RedrivePolicy (`maxReceiveCount=5` → DLQ ARN);
- [x] aplicação inicia — validada com `AUTH_ENABLED=true` (OIDC) e `false` (no-op);
- [x] migrations executam — 2 migrations aplicadas no banco dev (`wagering`);
- [x] migrations podem ser revertidas — `test/integration/migrations.test.ts` (down() migration por migration).

## Domínio

- [x] Money não utiliza `number` — `decimal.js` (Decimal) com escala fixa de 2 casas;
- [x] Money é imutável — construtor privado, campos `readonly`, operações retornam novas instâncias;
- [x] moeda é validada — ISO-4217 (3 letras maiúsculas);
- [x] valores inválidos são rejeitados — NaN, Infinity, notação científica, vazio, >2 casas, string inválida, moeda inválida;
- [x] Wallet encapsula saldo — `debit()`/`credit()` com validações de moeda e saldo;
- [x] saldo nunca fica negativo — `InsufficientFundsError` + constraint `wallets_balance_non_negative`;
- [x] version é incrementada corretamente — somente quando o saldo muda (testado);
- [x] transações possuem estados válidos — enum `WagerTransactionStatus` + validações de transição;
- [x] estados terminais não podem voltar — `PROCESSED`/`REJECTED`/`FAILED` (testado);
- [x] Ledger é imutável — trigger `trg_ledger_no_update` no banco + teste de integração.

## Banco

- [x] unique wallet por player/currency — constraint `wallets_player_id_currency_unique` + teste de integração;
- [x] idempotency constraint — `wager_transactions_idempotency_key_unique` + teste de integração;
- [x] payload hash persistido — coluna `payload_hash` + `matchesPayload`;
- [x] foreign keys — `fk_wager_tx_wallet`, `fk_wager_tx_reference`, `fk_ledger_wallet`, `fk_ledger_transaction`;
- [x] índices — provider+reference, wallet_id, status, ledger wallet_id, outbox published_at+next_attempt_at;
- [x] constraints financeiras — `wallets_balance_non_negative`, `wager_transactions_money_non_negative`, `ledger_money_non_negative`, `ledger_balances_non_negative`;
- [x] ledger append-only — trigger `trg_ledger_no_update` + teste de integração (UPDATE/DELETE rejeitados);
- [x] invariantes protegidas pelo schema — constraints + trigger + unique constraints.

## Operações

- [x] BET — débito com validação de saldo (testado);
- [x] WIN — crédito (testado);
- [x] LOSS — sem efeito no saldo, sem ledger (testado);
- [x] REFUND — crédito, exige referência BET (testado);
- [x] ROLLBACK — inverte direção da referência (testado);
- [x] OPENING — interno, criação de wallet com saldo inicial (testado);
- [x] saldo insuficiente — `INSUFFICIENT_FUNDS` (testado);
- [x] moeda incompatível — `CURRENCY_MISMATCH` (testado);
- [x] referência inexistente — `PENDING_REFERENCE` + worker (testado);
- [x] referência inválida — `REFERENCE_INVALID` (testado);
- [x] reversão duplicada — `DUPLICATE_REVERSAL` (testado).

## Idempotência

- [x] replay retorna resultado original — `idempotentReplay: true` (testado);
- [x] replay não altera saldo — verificado (testado);
- [x] replay não cria ledger — verificado (testado);
- [x] replay não cria efeito financeiro duplicado — verificado (testado);
- [x] mesma key + payload diferente = conflito — `ConflictException` + teste de integração;
- [x] funciona com múltiplas instâncias — testes de concorrência com 3+ instâncias.

## Concorrência

- [x] duas BET simultâneas — cenário obrigatório (testado);
- [x] 50 BET simultâneas — mesmo idempotency key (testado);
- [x] wallets diferentes em paralelo — saldos independentes (testado);
- [x] 3+ instâncias — 3 use cases concorrentes sobre a mesma wallet (testado);
- [x] sem lost update — lock pessimista `FOR UPDATE` por wallet (testado);
- [x] sem saldo negativo — invariante verificada (testado);
- [x] apenas um débito — 50 apostas → 1 lançamento (testado);
- [x] locks funcionam — `LockMode.PESSIMISTIC_WRITE` + métrica `wager_lock_conflicts_total`.

## SQS

- [x] producer — `OutboxPublisher` publica eventos na fila de integração;
- [x] consumer — `WagerTransactionConsumer` com poll loop e long polling;
- [x] FIFO — filas `.fifo` com MessageGroupId/MessageDeduplicationId;
- [x] DLQ — `wager-transactions-dlq.fifo` com RedrivePolicy (`maxReceiveCount=5`);
- [x] inbox — `inbox_messages` com `UNIQUE(consumer_name, message_id)`;
- [x] redelivery — mensagem não processada retorna à visibilidade (testado);
- [x] retry — erros transitórios não dão ack (testado);
- [x] ACK somente após commit — `ack()` após `useCase.execute()` (testado);
- [x] graceful shutdown — `onModuleDestroy` aguarda in-flight (testado);
- [x] erros transitórios — não deleta a mensagem (testado);
- [x] erros permanentes — BadRequest/Conflict → ack (testado).

## Outbox

- [x] evento salvo na mesma transação — `enqueue()` dentro da transação financeira (testado);
- [x] publicação somente após commit — publisher roda após o commit (testado);
- [x] retry — falha de publicação incrementa `attempts` (testado);
- [x] backoff — exponencial `2^attempts * 1000ms` limitado a 60s (testado);
- [x] múltiplos publishers — claim com `FOR UPDATE SKIP LOCKED` (testado);
- [x] crash recovery — evento pendente publicado por nova instância (testado);
- [x] eventos versionados — campo `version` no envelope;
- [x] correlationId — propagado do input para o evento;
- [x] causationId — campo no envelope (quando aplicável).

## Pending Reference

- [x] REFUND antes da BET — `PENDING_REFERENCE` + worker (testado);
- [x] ROLLBACK antes da referência — `PENDING_REFERENCE` + worker (testado);
- [x] PENDING_REFERENCE — status persistido com `reference_next_attempt_at`;
- [x] worker — `PendingReferenceWorker` com poll de 1s;
- [x] retry — `retryPendingReference` reprocessa (testado);
- [x] exponential backoff — `2^referenceAttempts * 1000ms` limitado a 60s;
- [x] max attempts — padrão 8, configurável;
- [x] rejeição definitiva — `REFERENCE_NOT_FOUND` após esgotar (testado).

## API

- [x] POST `/wallets` — cria wallet com saldo inicial (OPENING);
- [x] GET `/wallets/:walletId` — consulta saldo e versão;
- [x] GET `/wallets/:walletId/ledger` — cursor opaco + limit;
- [x] POST `/wagering/transactions` — com header `Idempotency-Key`;
- [x] GET transaction — por transactionId;
- [x] GET provider transaction — por providerId + externalTransactionId;
- [x] POST reconciliation — compara saldo armazenado vs ledger;
- [x] GET `/health/live` — liveness (público);
- [x] GET `/health/ready` — readiness (PostgreSQL + SQS, público).

## Observabilidade

- [x] JSON logs — logger estruturado com timestamp/level/context/message;
- [x] correlation ID — propagado nos logs e eventos;
- [x] transaction ID — nos logs e eventos;
- [x] wallet ID — nos logs e eventos;
- [x] provider ID — nos logs e eventos;
- [x] message ID — nos logs do consumer;
- [x] métricas de transações — `wager_transactions_total{status,kind}`;
- [x] métricas de retry — `wager_retries_total{source}`;
- [x] métricas de DLQ — `wager_dlq_messages_total`;
- [x] outbox lag — `wager_outbox_lag`;
- [x] lock conflicts — `wager_lock_conflicts_total`;
- [x] processing latency — `wager_processing_latency_seconds`.

## Testes

- [x] unitários — 12 testes (Money, Wallet, WagerTransaction);
- [x] integração — constraints, atomicidade, inbox, outbox, publishers, migrations, DLQ, retry, recovery;
- [x] PostgreSQL real — container PostgreSQL 16;
- [x] LocalStack real — container LocalStack 3.8;
- [x] E2E — cenários obrigatórios (3 instâncias, out-of-order, redelivery, consistência);
- [x] concorrência real — 50 apostas simultâneas, 3+ instâncias;
- [x] 50 requests simultâneas — mesmo idempotency key;
- [x] 3+ processos — 3 use cases concorrentes;
- [x] worker crash — worker morto antes do ack (redelivery);
- [x] publisher crash — evento pendente publicado por nova instância;
- [x] restart — ORM fechado e reaberto no meio do teste;
- [x] redelivery — inbox + SQS redelivery;
- [x] pending reference — REFUND/ROLLBACK antes da referência + retry + rejeição definitiva.

## Documentação

- [x] README.md — apresentação, setup, API, testes, troubleshooting;
- [x] ARCHITECTURE.md — 18 seções com decisões técnicas e trade-offs;
- [x] setup — docker compose + keycloak + localstack;
- [x] comandos — scripts do package.json;
- [x] variáveis de ambiente — `.env.example` completo;
- [x] exemplos de API — curl/wget no README;
- [x] exemplos de SQS — envelope da mensagem no README/ESCOPO;
- [x] estratégia de concorrência — pessimistic locking por wallet;
- [x] estratégia de idempotência — persistente com payload hash;
- [x] estratégia de outbox — transactional outbox com claim SKIP LOCKED;
- [x] trade-offs — pessimistic vs optimistic, FIFO vs standard, etc.;
- [x] limitações — auth desabilitada por padrão, métricas em memória, etc.

---

# 28. Critério de conclusão

A implementação deve ser considerada pronta somente quando:

```text
wallet.balance
      ==
saldo reconstruído pelo ledger
```

e os testes demonstrarem que essa igualdade permanece verdadeira após:

- duplicação de mensagens;
- processamento concorrente;
- múltiplas instâncias;
- redelivery;
- falhas entre commit e ACK;
- falhas de publicação;
- operações fora de ordem;
- reinicialização do serviço.

A prioridade durante o desenvolvimento deve ser:

```text
1. Correção financeira
2. Concorrência
3. Idempotência
4. Mensageria e recuperação
5. Modelagem/arquitetura
6. Testes
7. Observabilidade
8. Documentação
9. Autenticação, se houver tempo
```

---

# 29. Entrega final

Antes de enviar o repositório:

```text
[x] Código compilando — `bun run build` (nest build + tsc)
[x] Testes passando — 37 testes (unitários, integração, concorrência)
[x] Docker Compose funcionando — PostgreSQL 16 + LocalStack 3.8 + Keycloak 26
[x] PostgreSQL funcionando
[x] LocalStack funcionando
[x] SQS funcionando — 3 filas (wager, dlq, integration-events)
[x] Migrations funcionando — 2 migrations aplicadas e reversíveis
[x] Testes de concorrência passando
[x] Teste de 50 mensagens passando
[x] Teste com 3+ instâncias passando
[x] Teste de redelivery passando
[x] Teste de crash recovery passando
[x] Outbox validada
[x] Inbox validada
[x] Reconciliação validada
[x] README atualizado
[x] ARCHITECTURE.md atualizado
[x] .env.example atualizado
[x] Sem secrets no Git — .env ignorado, sem credenciais no repositório
[x] Git history organizada — commits por fase + diferenciais + check-in
[x] Repositório pronto para apresentação
```
