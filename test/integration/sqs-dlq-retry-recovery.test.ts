import { describe, test, expect, afterAll } from 'bun:test';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  PurgeQueueCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { getTestOrm, forkEm, closeTestOrm } from '../helpers/test-db';
import { OutboxPublisher } from '../../src/infrastructure/messaging/outbox/outbox-publisher.service';

/**
 * Cenários de integração SQS:
 * - DLQ: mensagem malformada excede maxReceiveCount e é redirecionada;
 * - retry: falha de publicação do outbox incrementa attempts e agenda backoff;
 * - recuperação: evento pendente na outbox (crash pós-commit) é publicado
 *   por uma nova instância do publisher.
 */

const ormPromise = getTestOrm();

async function rawQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const orm = await ormPromise;
  return orm.em.getConnection().execute(sql, params) as unknown as T[];
}

function sqs(): SQSClient {
  return new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });
}

async function queueUrl(client: SQSClient, name: string): Promise<string> {
  const res = await client.send(
    new GetQueueUrlCommand({ QueueName: name }),
  );
  return res.QueueUrl!;
}

describe('SQS — DLQ, retry do outbox e recuperação', () => {
  afterAll(async () => {
    await closeTestOrm();
  });

  test('DLQ: RedrivePolicy configurada e consumer não deleta mensagem malformada', async () => {
    const client = sqs();
    const mainUrl = await queueUrl(client, 'wager-transactions.fifo');
    const dlqUrl = await queueUrl(client, 'wager-transactions-dlq.fifo');

    // 1) RedrivePolicy: maxReceiveCount=5 → DLQ (na AWS, a mensagem é
    //    redirecionada automaticamente após 5 recebimentos; o LocalStack
    //    local não implementa o redrive automático para FIFO)
    const redriveRes = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: mainUrl,
        AttributeNames: ['RedrivePolicy'],
      }),
    );
    const redrive = JSON.parse(redriveRes.Attributes?.RedrivePolicy ?? '{}');
    const dlqArn = (
      await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: dlqUrl,
          AttributeNames: ['QueueArn'],
        }),
      )
    ).Attributes?.QueueArn;
    expect(redrive.deadLetterTargetArn).toBe(dlqArn);
    expect(Number(redrive.maxReceiveCount)).toBe(5);

    await client.send(new PurgeQueueCommand({ QueueUrl: mainUrl }));

    // 2) consumer real: mensagem inválida é acked (deletada); mensagem
    //    malformada NÃO é acked (permance na fila → alimenta a DLQ)
    const origEnabled = process.env.SQS_CONSUMER_ENABLED;
    const origQueue = process.env.SQS_WAGER_QUEUE_URL;
    process.env.SQS_CONSUMER_ENABLED = 'true';
    process.env.SQS_WAGER_QUEUE_URL = mainUrl;

    const em = await forkEm();
    const { WagerTransactionConsumer } = await import(
      '../../src/presentation/messaging/consumers/wager-transaction.consumer'
    );
    const consumer = new WagerTransactionConsumer(em);
    await consumer.onModuleInit();

    // mensagem inválida (OPENING não pode ser submetido) → BadRequest → ack
    await client.send(
      new SendMessageCommand({
        QueueUrl: mainUrl,
        MessageBody: JSON.stringify({
          messageId: 'invalid-opening',
          type: 'WagerTransactionRequested',
          occurredAt: new Date().toISOString(),
          data: {
            providerId: 'provider-a',
            externalTransactionId: 'invalid-opening',
            idempotencyKey: 'k:invalid-opening',
            playerId: crypto.randomUUID(),
            walletId: crypto.randomUUID(),
            roundId: 'r1',
            gameId: 'g1',
            kind: 'OPENING',
            money: { amount: '1.00', currency: 'BRL' },
          },
        }),
        MessageGroupId: 'dlq-test',
        MessageDeduplicationId: `inv-${Date.now()}`,
      }),
    );

    // mensagem malformada (tipo desconhecido) → consumer não deleta
    await client.send(
      new SendMessageCommand({
        QueueUrl: mainUrl,
        MessageBody: JSON.stringify({ type: 'Unknown', messageId: 'malformed-1' }),
        MessageGroupId: 'dlq-test',
        MessageDeduplicationId: `mal-${Date.now()}`,
      }),
    );

    // aguarda o poll do consumer (long polling de até 5s)
    await new Promise((r) => setTimeout(r, 8000));

    const state = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: mainUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
        ],
      }),
    );
    const visible = Number(state.Attributes?.ApproximateNumberOfMessages ?? 0);
    const notVisible = Number(
      state.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0,
    );
    // a malformada permanece (visível ou em voo até o visibility timeout);
    // a inválida foi deletada pelo ack
    expect(visible + notVisible).toBe(1);

    await consumer.onModuleDestroy();
    process.env.SQS_CONSUMER_ENABLED = origEnabled;
    process.env.SQS_WAGER_QUEUE_URL = origQueue;

    // limpa a mensagem malformada
    const leftover = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: mainUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 0,
        WaitTimeSeconds: 1,
      }),
    );
    for (const m of leftover.Messages ?? []) {
      await client.send(
        new DeleteMessageCommand({ QueueUrl: mainUrl, ReceiptHandle: m.ReceiptHandle! }),
      );
    }
  }, 30_000);

  test('outbox retry: falha no SQS incrementa attempts e agenda backoff', async () => {
    const orm = await ormPromise;
    await rawQuery(`delete from outbox_messages`);
    await rawQuery(
      `insert into outbox_messages
         (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at, published_at)
       values (gen_random_uuid(), gen_random_uuid(), 'WalletBalanceChanged',
               '{"retry": true}'::jsonb, now(), 0, null, null)`,
    );

    // endpoint inválido: publicação falha
    const origEndpoint = process.env.SQS_ENDPOINT;
    const origQueue = process.env.SQS_EVENTS_QUEUE_URL;
    process.env.SQS_ENDPOINT = 'http://localhost:9999';
    process.env.SQS_EVENTS_QUEUE_URL =
      'http://localhost:9999/000000000000/integration-events.fifo';
    const failingPublisher = new OutboxPublisher(orm.em.fork());
    await failingPublisher.tick();
    process.env.SQS_ENDPOINT = origEndpoint;
    process.env.SQS_EVENTS_QUEUE_URL = origQueue;

    const rows = await rawQuery<{
      attempts: number;
      published_at: string | null;
      next_attempt_at: string | null;
    }>(`select attempts, published_at, next_attempt_at from outbox_messages`);
    expect(Number(rows[0].attempts)).toBe(1);
    expect(rows[0].published_at).toBeNull();
    // backoff exponencial: próxima tentativa no futuro (2^1 * 1000ms)
    expect(rows[0].next_attempt_at).not.toBeNull();
    expect(new Date(rows[0].next_attempt_at!).getTime()).toBeGreaterThan(
      Date.now(),
    );

    // enquanto next_attempt_at estiver no futuro, a linha não é reivindicável
    const eligible = await rawQuery<{ c: string }>(
      `select count(*) as c from outbox_messages
       where published_at is null
         and (next_attempt_at is null or next_attempt_at <= now())`,
    );
    expect(Number(eligible[0].c)).toBe(0);

    await rawQuery(`delete from outbox_messages`);
  });

  test('recuperação: evento pendente na outbox (crash pós-commit) é publicado por nova instância', async () => {
    const orm = await ormPromise;
    const client = sqs();
    const eventsUrl = await queueUrl(client, 'integration-events.fifo');
    await client.send(new PurgeQueueCommand({ QueueUrl: eventsUrl }));

    await rawQuery(`delete from outbox_messages`);
    // simula crash: commit financeiro persistiu o evento, mas o publisher morreu antes de publicar
    await rawQuery(
      `insert into outbox_messages
         (id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at, published_at)
       values (gen_random_uuid(), gen_random_uuid(), 'WalletBalanceChanged',
               '{"eventId":"evt-1","eventType":"WalletBalanceChanged","aggregateId":"agg-1","data":{"recovered":true}}'::jsonb,
               now(), 0, null, null)`,
    );

    // nova instância (outra assume) publica o evento pendente
    const publisher = new OutboxPublisher(orm.em.fork());
    const processed = await publisher.tick();
    expect(processed).toBe(1);

    const published = await rawQuery<{ c: string }>(
      `select count(*) as c from outbox_messages where published_at is not null`,
    );
    expect(Number(published[0].c)).toBe(1);

    // evento visível na fila de integração
    let eventMessage;
    for (let i = 0; i < 10 && !eventMessage; i++) {
      const res = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: eventsUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 1,
        }),
      );
      eventMessage = res.Messages?.[0];
      if (!eventMessage) await new Promise((r) => setTimeout(r, 300));
    }
    expect(eventMessage).toBeDefined();
    const payload = JSON.parse(eventMessage!.Body ?? '{}');
    expect(payload.data.recovered).toBe(true);

    // limpa
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: eventsUrl,
        ReceiptHandle: eventMessage!.ReceiptHandle!,
      }),
    );
    await rawQuery(`delete from outbox_messages`);
  });
});
