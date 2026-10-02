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

- [ ] operações do `Money`;
- [ ] escala monetária;
- [ ] entradas inválidas;
- [ ] invariantes da Wallet;
- [ ] BET;
- [ ] WIN;
- [ ] LOSS;
- [ ] REFUND;
- [ ] ROLLBACK;
- [ ] conflito de moeda;
- [ ] idempotency key com payload divergente;
- [ ] transições de estado.

## 22.2 Testes de integração

Utilizar PostgreSQL e LocalStack reais em containers.

Testar:

- [ ] migrations;
- [ ] constraints;
- [ ] atomicidade;
- [ ] wallet + ledger;
- [ ] inbox;
- [ ] outbox;
- [ ] publishers concorrentes;
- [ ] retry;
- [ ] DLQ;
- [ ] redelivery;
- [ ] recuperação após reinicialização.

## 22.3 Testes de concorrência

- [ ] mesma aposta enviada 50 vezes em paralelo;
- [ ] duas apostas concorrentes sobre o mesmo saldo;
- [ ] wallets diferentes processadas em paralelo;
- [ ] três ou mais instâncias simultâneas;
- [ ] worker morto após commit e antes do ACK;
- [ ] dois publishers sobre a mesma outbox;
- [ ] ROLLBACK antes da referência;
- [ ] REFUND antes da referência;
- [ ] reinicialização do serviço;
- [ ] verificação final de consistência.

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

- [ ] `docker compose up` funciona.
- [ ] PostgreSQL inicia.
- [ ] LocalStack inicia.
- [ ] SQS é criado.
- [ ] DLQ é criada.
- [ ] aplicação inicia.
- [ ] migrations executam.
- [ ] migrations podem ser revertidas.

## Domínio

- [ ] Money não utiliza `number`.
- [ ] Money é imutável.
- [ ] moeda é validada.
- [ ] valores inválidos são rejeitados.
- [ ] Wallet encapsula saldo.
- [ ] saldo nunca fica negativo.
- [ ] version é incrementada corretamente.
- [ ] transações possuem estados válidos.
- [ ] estados terminais não podem voltar.
- [ ] Ledger é imutável.

## Banco

- [ ] unique wallet por player/currency.
- [ ] idempotency constraint.
- [ ] payload hash persistido.
- [ ] foreign keys.
- [ ] índices.
- [ ] constraints financeiras.
- [ ] ledger append-only.
- [ ] invariantes protegidas pelo schema.

## Operações

- [ ] BET.
- [ ] WIN.
- [ ] LOSS.
- [ ] REFUND.
- [ ] ROLLBACK.
- [ ] OPENING.
- [ ] saldo insuficiente.
- [ ] moeda incompatível.
- [ ] referência inexistente.
- [ ] referência inválida.
- [ ] reversão duplicada.

## Idempotência

- [ ] replay retorna resultado original.
- [ ] replay não altera saldo.
- [ ] replay não cria ledger.
- [ ] replay não cria efeito financeiro duplicado.
- [ ] mesma key + payload diferente = conflito.
- [ ] funciona com múltiplas instâncias.

## Concorrência

- [ ] duas BET simultâneas.
- [ ] 50 BET simultâneas.
- [ ] wallets diferentes em paralelo.
- [ ] 3+ instâncias.
- [ ] sem lost update.
- [ ] sem saldo negativo.
- [ ] apenas um débito.
- [ ] locks funcionam.

## SQS

- [ ] producer.
- [ ] consumer.
- [ ] FIFO.
- [ ] DLQ.
- [ ] inbox.
- [ ] redelivery.
- [ ] retry.
- [ ] ACK somente após commit.
- [ ] graceful shutdown.
- [ ] erros transitórios.
- [ ] erros permanentes.

## Outbox

- [ ] evento salvo na mesma transação.
- [ ] publicação somente após commit.
- [ ] retry.
- [ ] backoff.
- [ ] múltiplos publishers.
- [ ] crash recovery.
- [ ] eventos versionados.
- [ ] correlationId.
- [ ] causationId.

## Pending Reference

- [ ] REFUND antes da BET.
- [ ] ROLLBACK antes da referência.
- [ ] PENDING_REFERENCE.
- [ ] worker.
- [ ] retry.
- [ ] exponential backoff.
- [ ] max attempts.
- [ ] rejeição definitiva.

## API

- [ ] POST `/wallets`.
- [ ] GET `/wallets/:walletId`.
- [ ] GET `/wallets/:walletId/ledger`.
- [ ] POST `/wagering/transactions`.
- [ ] GET transaction.
- [ ] GET provider transaction.
- [ ] POST reconciliation.
- [ ] GET `/health/live`.
- [ ] GET `/health/ready`.

## Observabilidade

- [ ] JSON logs.
- [ ] correlation ID.
- [ ] transaction ID.
- [ ] wallet ID.
- [ ] provider ID.
- [ ] message ID.
- [ ] métricas de transações.
- [ ] métricas de retry.
- [ ] métricas de DLQ.
- [ ] outbox lag.
- [ ] lock conflicts.
- [ ] processing latency.

## Testes

- [ ] unitários.
- [ ] integração.
- [ ] PostgreSQL real.
- [ ] LocalStack real.
- [ ] E2E.
- [ ] concorrência real.
- [ ] 50 requests simultâneas.
- [ ] 3+ processos.
- [ ] worker crash.
- [ ] publisher crash.
- [ ] restart.
- [ ] redelivery.
- [ ] pending reference.

## Documentação

- [ ] README.md.
- [ ] ARCHITECTURE.md.
- [ ] setup.
- [ ] comandos.
- [ ] variáveis de ambiente.
- [ ] exemplos de API.
- [ ] exemplos de SQS.
- [ ] estratégia de concorrência.
- [ ] estratégia de idempotência.
- [ ] estratégia de outbox.
- [ ] trade-offs.
- [ ] limitações.

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
[ ] Código compilando
[ ] Testes passando
[ ] Docker Compose funcionando
[ ] PostgreSQL funcionando
[ ] LocalStack funcionando
[ ] SQS funcionando
[ ] Migrations funcionando
[ ] Testes de concorrência passando
[ ] Teste de 50 mensagens passando
[ ] Teste com 3+ instâncias passando
[ ] Teste de redelivery passando
[ ] Teste de crash recovery passando
[ ] Outbox validada
[ ] Inbox validada
[ ] Reconciliação validada
[ ] README atualizado
[ ] ARCHITECTURE.md atualizado
[ ] .env.example atualizado
[ ] Sem secrets no Git
[ ] Git history organizada
[ ] Repositório pronto para apresentação
```
