import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, ValidationPipe } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { randomUUID } from 'crypto';
import { mikroOrmConfig } from '../../src/infrastructure/database/mikro-orm.config';
import { WalletsController } from '../../src/presentation/http/wallets/wallets.controller';
import { WageringController } from '../../src/presentation/http/wagering/wagering.controller';
import { HealthController } from '../../src/presentation/http/health/health.controller';
import { MetricsController } from '../../src/presentation/http/metrics/metrics.controller';
import { AuthModule } from '../../src/presentation/http/auth/auth.module';

process.env.AUTH_ENABLED = 'false';
process.env.SQS_ENDPOINT ??= 'http://localhost:4566';
process.env.AWS_REGION ??= 'us-east-1';
process.env.AWS_ACCESS_KEY_ID ??= 'test';
process.env.AWS_SECRET_ACCESS_KEY ??= 'test';

@Module({
  imports: [
    MikroOrmModule.forRoot({
      ...mikroOrmConfig,
      dbName: process.env.DB_NAME_TEST ?? 'wagering_test',
    }),
    AuthModule.register(),
  ],
  controllers: [WalletsController, WageringController, HealthController, MetricsController],
})
class HttpApiTestModule {}

describe('integração HTTP — rotas e contratos', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(HttpApiTestModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('test HTTP server did not bind to a TCP port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  test('health público, validação, criação, operações, consultas e reconciliação', async () => {
    const live = await fetch(`${baseUrl}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'ok' });

    const ready = await fetch(`${baseUrl}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: 'ready',
      postgres: true,
      sqs: true,
    });

    const playerId = randomUUID();
    const createWallet = () =>
      fetch(`${baseUrl}/wallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          initialBalance: { amount: '100.00', currency: 'BRL' },
        }),
      });
    const walletResponse = await createWallet();
    expect(walletResponse.status).toBe(201);
    const wallet = (await walletResponse.json()) as {
      id: string;
      balance: { amount: string; currency: string };
      version: number;
    };
    expect(wallet.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);

    const duplicateWallet = await createWallet();
    expect(duplicateWallet.status).toBe(409);

    const missingKey = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'provider-http',
        externalTransactionId: randomUUID(),
        playerId,
        walletId: wallet.id,
        roundId: 'round-http',
        gameId: 'game-http',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      }),
    });
    expect(missingKey.status).toBe(400);

    const idempotencyKey = `http:${randomUUID()}`;
    const externalTransactionId = randomUUID();
    const betBody = {
      providerId: 'provider-http',
      externalTransactionId,
      playerId,
      walletId: wallet.id,
      roundId: 'round-http',
      gameId: 'game-http',
      kind: 'BET',
      money: { amount: '10.00', currency: 'BRL' },
    };
    const submit = (body: typeof betBody, key = idempotencyKey) =>
      fetch(`${baseUrl}/wagering/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      });
    const betResponse = await submit(betBody);
    expect(betResponse.status).toBe(200);
    const bet = (await betResponse.json()) as {
      transactionId: string;
      status: string;
      balance: { amount: string; currency: string };
      idempotentReplay: boolean;
    };
    expect(bet.status).toBe('PROCESSED');
    expect(bet.balance.amount).toBe('90.00');
    expect(bet.idempotentReplay).toBe(false);

    const replayResponse = await submit(betBody);
    const replay = (await replayResponse.json()) as typeof bet;
    expect(replayResponse.status).toBe(200);
    expect(replay.transactionId).toBe(bet.transactionId);
    expect(replay.idempotentReplay).toBe(true);

    const conflict = await submit({
      ...betBody,
      money: { amount: '11.00', currency: 'BRL' },
    });
    expect(conflict.status).toBe(409);

    const winExternalTransactionId = randomUUID();
    const winResponse = await submit(
      {
        ...betBody,
        externalTransactionId: winExternalTransactionId,
        kind: 'WIN',
        money: { amount: '5.00', currency: 'BRL' },
      },
      `win:${randomUUID()}`,
    );
    expect(winResponse.status).toBe(200);

    const replayAfterBalanceChange = await submit(betBody);
    const historicalReplay = (await replayAfterBalanceChange.json()) as typeof bet;
    expect(historicalReplay.balance.amount).toBe('90.00');

    const walletRead = await fetch(`${baseUrl}/wallets/${wallet.id}`);
    expect(walletRead.status).toBe(200);
    const currentWallet = (await walletRead.json()) as {
      balance: { amount: string; currency: string };
    };
    expect(currentWallet.balance.amount).toBe('95.00');

    const ledgerFirstPage = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger?limit=1`);
    const firstPage = (await ledgerFirstPage.json()) as {
      data: Array<{ transactionId: string }>;
      nextCursor?: string;
    };
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();

    const ledgerSecondPage = await fetch(
      `${baseUrl}/wallets/${wallet.id}/ledger?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    );
    const secondPage = (await ledgerSecondPage.json()) as {
      data: Array<{ transactionId: string }>;
      nextCursor?: string;
    };
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.data[0].transactionId).not.toBe(firstPage.data[0].transactionId);

    const transactionById = await fetch(`${baseUrl}/wagering/transactions/${bet.transactionId}`);
    expect(transactionById.status).toBe(200);
    expect((await transactionById.json()).id).toBe(bet.transactionId);

    const transactionByProvider = await fetch(
      `${baseUrl}/providers/provider-http/wagering/transactions/${externalTransactionId}`,
    );
    expect(transactionByProvider.status).toBe(200);
    expect((await transactionByProvider.json()).id).toBe(bet.transactionId);

    const reconciliation = await fetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, {
      method: 'POST',
    });
    const reconciliationResult = (await reconciliation.json()) as {
      consistent: boolean;
      difference: { amount: string };
    };
    expect(reconciliationResult.consistent).toBe(true);
    expect(reconciliationResult.difference.amount).toBe('0.00');

    const metrics = await fetch(`${baseUrl}/metrics`);
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get('content-type')).toContain('text/plain');
    const metricsBody = await metrics.text();
    for (const metric of [
      'wager_transactions_total',
      'wager_duplicates_detected_total',
      'wager_retries_total',
      'wager_dlq_messages_total',
      'wager_lock_conflicts_total',
      'wager_outbox_lag',
      'wager_processing_latency_seconds',
    ]) {
      expect(metricsBody).toContain(`# TYPE ${metric} `);
    }
    expect(metricsBody).toMatch(/wager_duplicates_detected_total [1-9]\d*/);
  });
});
