import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { createHash } from 'crypto';
import { ProcessWagerTransactionUseCase } from '../../../application/wagering/process-wager-transaction.use-case';
import { WagerTransactionKind } from '../../../domain/wagering/enums/wager-kind.enum';
import { ConflictException, BadRequestException } from '@nestjs/common';

interface WagerQueueMessage {
  messageId: string;
  type: 'WagerTransactionRequested';
  occurredAt: string;
  data: Record<string, unknown> & {
    kind: WagerTransactionKind;
    money: { amount: string; currency: string };
  };
}

const CONSUMER_NAME = 'wager-transaction-consumer';

@Injectable()
export class WagerTransactionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WagerTransactionConsumer.name);
  private sqsClient!: SQSClient;
  private queueUrl!: string;
  private stopRequested = false;
  private inFlight = 0;
  private pollHandle?: ReturnType<typeof setTimeout>;

  constructor(private readonly em: EntityManager) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SQS_CONSUMER_ENABLED !== 'true') {
      this.logger.log('SQS consumer disabled (SQS_CONSUMER_ENABLED != true)');
      return;
    }
    this.queueUrl = process.env.SQS_WAGER_QUEUE_URL ?? '';
    const { createSqsClient } = await import('../../../infrastructure/messaging/sqs/sqs.client');
    this.sqsClient = createSqsClient();
    this.stopRequested = false;
    void this.pollLoop();
    this.logger.log('SQS consumer started');
  }

  async onModuleDestroy(): Promise<void> {
    this.stopRequested = true;
    if (this.pollHandle) clearTimeout(this.pollHandle);
    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.logger.log('SQS consumer stopped');
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        const res = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5,
            VisibilityTimeout: 30,
          }),
        );
        for (const msg of res.Messages ?? []) {
          this.inFlight += 1;
          try {
            await this.handle(msg);
          } finally {
            this.inFlight -= 1;
          }
        }
      } catch (err) {
        this.logger.error(`poll error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handle(msg: Message): Promise<void> {
    const messageId = msg.MessageId ?? '';
    try {
      const body = JSON.parse(msg.Body ?? '{}') as WagerQueueMessage;
      if (body.type !== 'WagerTransactionRequested' || !body.data) {
        this.logger.warn(`malformed message ${messageId} -> leaving for DLQ`);
        return;
      }
      const payloadHash = createHash('sha256').update(JSON.stringify(body.data)).digest('hex');
      const useCase = new ProcessWagerTransactionUseCase(this.em.fork());
      await useCase.execute(
        {
          providerId: body.data.providerId as string,
          externalTransactionId: body.data.externalTransactionId as string,
          idempotencyKey: body.data.idempotencyKey as string,
          playerId: body.data.playerId as string,
          walletId: body.data.walletId as string,
          roundId: body.data.roundId as string,
          gameId: body.data.gameId as string,
          kind: body.data.kind,
          money: body.data.money,
          referenceExternalTransactionId: body.data.referenceExternalTransactionId as
            | string
            | undefined,
        },
        {
          inbox: {
            messageId: body.messageId ?? messageId,
            consumerName: CONSUMER_NAME,
            payloadHash,
            receivedAt: new Date(),
          },
        },
      );
      await this.ack(msg);
    } catch (err) {
      if (err instanceof ConflictException) {
        // conflito de idempotência é terminal para esta mensagem
        this.logger.warn(`idempotency conflict for ${messageId} -> ack`);
        await this.ack(msg);
        return;
      }
      if (err instanceof BadRequestException) {
        this.logger.warn(`invalid message ${messageId}: ${err.message} -> ack`);
        await this.ack(msg);
        return;
      }
      // transitório: não apaga; volta à visibilidade e segue para DLQ após maxReceiveCount
      this.logger.error(`transient error for ${messageId}: ${(err as Error).message} -> retry/DLQ`);
    }
  }

  private async ack(msg: Message): Promise<void> {
    await this.sqsClient.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: msg.ReceiptHandle }),
    );
  }
}
