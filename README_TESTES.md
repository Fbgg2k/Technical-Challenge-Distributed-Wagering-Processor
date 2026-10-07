# Guia de testes — Distributed Wagering Processor

Este guia reúne os passos para subir o projeto localmente, verificar os serviços e
executar testes manuais e automatizados. O projeto é um backend REST; não possui
interface gráfica ou frontend.

## 1. Pré-requisitos

- Bun 1.x
- Docker com Docker Compose
- `curl` para os exemplos HTTP

Os exemplos abaixo pressupõem Linux com Bash e execução a partir da pasta raiz do
projeto.

## 2. Preparar e iniciar o ambiente

Crie o arquivo local de configuração a partir do modelo:

```bash
cp .env.example .env
```

O `.env.example` é um modelo; a aplicação carrega as variáveis do `.env`. Para
rodar a API diretamente na máquina, mantenha `DB_HOST=localhost`,
`SQS_ENDPOINT=http://localhost:4566` e os três workers habilitados:

```env
SQS_CONSUMER_ENABLED=true
OUTBOX_PUBLISHER_ENABLED=true
PENDING_REFERENCE_WORKER_ENABLED=true
```

Instale as dependências, inicie PostgreSQL e LocalStack e aplique as migrations:

```bash
bun install
docker compose up -d postgres localstack
bun run migration:up
```

Inicie a API em modo de desenvolvimento e deixe esse terminal aberto:

```bash
bun run start:dev
```

Se `bun` não for encontrado após a instalação no Linux, carregue a configuração do
shell e tente novamente:

```bash
source ~/.bashrc
bun --version
```

Em outro terminal, também na pasta do projeto, verifique os serviços:

```bash
docker compose ps
docker compose exec localstack awslocal sqs list-queues
curl -i http://localhost:3000/health/live
curl -i http://localhost:3000/health/ready
```

O PostgreSQL e o LocalStack devem estar saudáveis, as filas devem estar listadas,
`/health/live` deve responder `200` com `{"status":"ok"}` e `/health/ready` deve
responder `200` com `postgres: true` e `sqs: true`. Se a prontidão retornar `503`,
confira os logs e as configurações antes de prosseguir:

```bash
docker compose logs --tail=50 localstack
```

Confirme também `SQS_ENDPOINT=http://localhost:4566` no `.env` e reinicie a API
para que ela carregue eventuais alterações. Se os workers aparecerem como
desativados nos logs da aplicação, confira suas variáveis no `.env`.

## 3. Testes manuais da API

As rotas aceitam JSON. Use valores monetários como strings com até duas casas
decimais, por exemplo `"20.00"`. Os campos `playerId` e `walletId` devem ser UUIDs.
Substitua `WALLET_ID` pelo ID retornado ao criar a carteira. Mantenha estas
variáveis no mesmo terminal em que executará os comandos seguintes:

```bash
PLAYER_ID="11111111-1111-4111-8111-111111111111"
WALLET_ID="COLE-AQUI-O-ID-RETORNADO"
```

Não envie o texto `COLE-AQUI-O-ID-RETORNADO`: substitua-o pelo UUID real, sem
aspas angulares.

### 3.1 Criar uma carteira

Este exemplo funciona em um banco limpo para esse `playerId` e moeda. Se já houver
uma carteira BRL para o jogador, escolha outro UUID de jogador.

```bash
curl -i -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{
    "playerId": "11111111-1111-4111-8111-111111111111",
    "initialBalance": {
      "amount": "100.00",
      "currency": "BRL"
    }
  }'
```

Esperado: `201 Created`, com `id` da carteira e saldo inicial de `100.00 BRL`.
Copie o `id` retornado para `WALLET_ID` no terminal:

```bash
WALLET_ID="UUID-RETORNADO-PELA-API"
```

### 3.2 Fazer uma aposta

```bash
curl -i -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: aposta-manual-001" \
  -d "{
    \"providerId\": \"provedor-teste\",
    \"externalTransactionId\": \"transacao-manual-001\",
    \"playerId\": \"$PLAYER_ID\",
    \"walletId\": \"$WALLET_ID\",
    \"roundId\": \"rodada-manual-001\",
    \"gameId\": \"jogo-teste\",
    \"kind\": \"BET\",
    \"money\": {
      \"amount\": \"20.00\",
      \"currency\": \"BRL\"
    }
  }"
```

Esperado: `200 OK`, status `PROCESSED`, `idempotentReplay: false` e saldo de
`80.00 BRL`.

### 3.3 Consultar saldo e ledger

```bash
curl -i "http://localhost:3000/wallets/$WALLET_ID"
curl -i "http://localhost:3000/wallets/$WALLET_ID/ledger"
```

Esperado: saldo `80.00 BRL`; o ledger deve conter o crédito de abertura de
`100.00 BRL` e o débito da aposta de `20.00 BRL`. O débito deve indicar saldo
anterior `100.00` e posterior `80.00`.

### 3.4 Repetir a mesma aposta (idempotência)

Execute novamente exatamente o comando da seção 3.2, sem mudar o corpo nem o
`Idempotency-Key`. Esperado: o mesmo `transactionId`, status `PROCESSED` e
`idempotentReplay: true`. O saldo e o número de lançamentos não devem mudar.

### 3.5 Reutilizar a chave com outro corpo (conflito)

Envie a aposta da seção 3.2 novamente com o mesmo `Idempotency-Key`, mas altere
`money.amount`, por exemplo para `"21.00"`. Esperado: `409 Conflict`; a mesma chave
não pode identificar um payload diferente. O saldo deve continuar inalterado.

### 3.6 Apostar acima do saldo

Use uma chave e um `externalTransactionId` novos para esta tentativa:

```bash
curl -i -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: aposta-sem-saldo-001" \
  -d "{
    \"providerId\": \"provedor-teste\",
    \"externalTransactionId\": \"transacao-sem-saldo-001\",
    \"playerId\": \"$PLAYER_ID\",
    \"walletId\": \"$WALLET_ID\",
    \"roundId\": \"rodada-sem-saldo\",
    \"gameId\": \"jogo-teste\",
    \"kind\": \"BET\",
    \"money\": { \"amount\": \"999.00\", \"currency\": \"BRL\" }
  }"
```

Esperado: `200 OK` com status `REJECTED`, `failureCode: INSUFFICIENT_FUNDS` e o
saldo ainda em `80.00 BRL`. Neste projeto, uma rejeição de negócio é representada
no corpo da resposta; não se espera necessariamente um HTTP `4xx`.

Repita exatamente a tentativa com a mesma chave e o mesmo corpo. Esperado:
`idempotentReplay: true`, mesmo `transactionId` e nenhum novo lançamento no ledger.

### 3.7 Reconciliar a carteira

```bash
curl -i -X POST "http://localhost:3000/wallets/$WALLET_ID/reconciliation"
```

Esperado: `consistent: true`, diferença `0.00 BRL` e saldos calculado e
armazenado iguais. A rota pode responder `201 Created`, pois o controller não
define outro código HTTP para esse `POST`.

### 3.8 Consultar transação e métricas

Use o `transactionId` retornado pela criação da aposta:

```bash
curl -i http://localhost:3000/wagering/transactions/UUID-DA-TRANSACAO
curl -i http://localhost:3000/metrics
```

A consulta da transação deve retornar seus dados e status. `/metrics` deve
responder `200 OK` com métricas em formato Prometheus. Contadores em zero podem
ser normais após reiniciar a API, pois as métricas são mantidas em memória pelo
processo.

## 4. Testes automatizados

Com as dependências instaladas, execute os testes unitários:

```bash
bun run test:unit
```

Os testes de integração e concorrência usam um banco separado, `wagering_test` por
padrão. Crie esse banco uma vez:

```bash
docker compose exec postgres createdb -U wagering wagering_test
```

Se o comando informar que o banco já existe, ele já está criado; prossiga. Os
scripts de integração e concorrência aplicam as migrations nesse banco de teste
através do preload:

```bash
bun run test:integration
bun run test:concurrency
bun run test:e2e
```

Para rodar a suíte completa, confirme que o banco de teste existe antes. Use
`bun run test` para chamar o script do projeto, que inclui o preload de schema:

```bash
bun run test
```

O nome pode ser alterado com `DB_NAME_TEST`. Para validar também compilação e
tipos:

```bash
bun run typecheck
bun run build
```

### Matriz de cobertura automatizada

| Requisito do `README_JG.md`                                                                                                 | Cobertura                                         |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Precisão, escala, imutabilidade e moedas de `Money`                                                                         | `test/unit/money.test.ts`                         |
| Canonicalização e hash de payload                                                                                           | `test/unit/payload-hash.test.ts`                  |
| Invariantes e versionamento da wallet                                                                                       | `test/unit/wallet.test.ts`                        |
| Estados de transação, kinds e direção de reversão                                                                           | `test/unit/wager-transaction.test.ts`             |
| `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`, saldo insuficiente, regras de referência e replay do saldo original             | `test/integration/wager-business-rules.test.ts`   |
| Rotas HTTP, DTOs, idempotência, paginação do ledger, health, reconciliação e exposição das métricas                         | `test/integration/http-api.test.ts`               |
| Constraints, ledger append-only, atomicidade, inbox/redelivery e publishers concorrentes                                    | `test/integration/database-and-outbox.test.ts`    |
| Migrations reversíveis e constraints do schema                                                                              | `test/integration/migrations.test.ts`             |
| SQS real, ack após commit, DLQ, retry do outbox e recuperação                                                               | `test/integration/sqs-dlq-retry-recovery.test.ts` |
| Apostas concorrentes, 50 redeliveries, wallets distintas, 3 instâncias lógicas, referências fora de ordem e reinicialização | `test/concurrency/`                               |

Na última execução desta suíte, `bun run test` terminou com **51 testes
aprovados, 0 falhas**, em 11 arquivos. `bun run typecheck` também passou.
`bun run build` também foi executado com sucesso.
Esses resultados refletem a execução local documentada e devem ser repetidos
depois de alterações no código.

### Limites da cobertura automatizada atual

- O cenário de três instâncias usa três operações concorrentes com `EntityManager`
  independentes no mesmo processo Bun; não inicia três processos de sistema
  separados.
- A redelivery após commit é testada por repetição com o mesmo inbox; não há um
  teste que envie `SIGTERM` ao processo exatamente entre o commit e o ack, nem
  que valide o encerramento enquanto há mensagens em andamento.
- O teste de observabilidade verifica a disponibilidade dos nomes de métricas e
  que a métrica de duplicatas aumenta. Ainda não verifica todos os contadores
  (por exemplo retry/DLQ/lock/outbox lag) nem comprova em logs cada identificador
  exigido ou a ausência de dados financeiros sensíveis.
- OIDC é opcional no desafio e permanece desabilitado por padrão; a suíte HTTP
  valida as rotas no modo local sem autenticação, não uma integração com
  Keycloak/Zitadel.

O teste de carga é opcional e envia várias transações concorrentes:

```bash
LOAD_DURATION_MS=30000 LOAD_CONCURRENCY=50 bun run test:load
```

## 5. Evidências manuais registradas nesta execução

Na execução local documentada durante a preparação do projeto, foram observados:

- `/health/live` e `/health/ready` responderam com sucesso; a prontidão confirmou
  PostgreSQL e SQS disponíveis.
- Uma aposta de `20.00 BRL` foi processada como `PROCESSED`; o saldo passou de
  `100.00 BRL` para `80.00 BRL`.
- O ledger registrou o crédito de abertura e o débito da aposta, com saldos antes
  e depois coerentes.
- A reconciliação retornou `consistent: true`, diferença `0.00 BRL` e dois
  lançamentos.
- Uma aposta de `999.00 BRL` foi rejeitada por `INSUFFICIENT_FUNDS`, sem alterar
  o saldo. Repeti-la com a mesma chave retornou `idempotentReplay: true`.
- A consulta de transação e o endpoint `/metrics` responderam com sucesso.

Essas evidências são de testes manuais locais; não significam que a suíte
automatizada foi executada. Antes da entrega, rode os testes automatizados e
registre os resultados reais do ambiente de entrega.

## 6. Problemas comuns

- **`.env.example` encontrado, mas `.env` ausente:** crie-o com
  `cp .env.example .env`.
- **`bun: comando não encontrado`:** instale Bun; no Bash, após instalação,
  execute `source ~/.bashrc`.
- **`docker compose` informa que não encontrou configuração:** entre na pasta raiz
  do projeto, onde está `docker-compose.yml`.
- **`/health/ready` retorna `postgres: true`, `sqs: false`:** verifique se o
  LocalStack está saudável, se as filas existem, se `SQS_ENDPOINT` aponta para
  `http://localhost:4566` e se a API foi reiniciada após criar ou editar `.env`.
- **`playerId must be a UUID` ou `walletId must be a UUID`:** substitua os
  exemplos pelos UUIDs reais. Não deixe marcadores como `ID_DA_CARTEIRA` ou
  `WALLET_ID` dentro da requisição.
- **`Cannot GET /wallets/` ou `Cannot POST /wallets//reconciliation`:** a variável
  `WALLET_ID` está vazia ou não foi definida naquele terminal. Defina-a novamente
  com o ID retornado pela API.
- **`409 Conflict` em teste repetido:** confira se está usando a mesma chave e o
  mesmo payload para replay; para uma nova transação, use chave e identificador
  externo novos.

Para encerrar os serviços auxiliares:

```bash
docker compose down
```

Esse comando para os containers, mas preserva os volumes do banco e do LocalStack.
