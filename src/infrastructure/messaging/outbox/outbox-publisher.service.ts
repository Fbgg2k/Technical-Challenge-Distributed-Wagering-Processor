import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { OutboxMessageOrmEntity } from '../../database/entities/outbox-message.orm-entity';
import { createSqsClient } from '../sqs/sqs.client';

const LEASE_MS = 30_000;

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly client: SQSClient = createSqsClient();
  private readonly queueUrl = process.env.SQS_EVENTS_QUEUE_URL ?? '';
  private stopRequested = false;
  private inFlight = 0;

  constructor(private readonly em: EntityManager) {}

  onModuleInit(): void {
    if (process.env.OUTBOX_PUBLISHER_ENABLED !== 'true') {
      this.logger.log('outbox publisher disabled (OUTBOX_PUBLISHER_ENABLED != true)');
      return;
    }
    void this.loop();
    this.logger.log('outbox publisher started');
  }

  async onModuleDestroy(): Promise<void> {
    this.stopRequested = true;
    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.logger.log('outbox publisher stopped');
  }

  private async loop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        const processed = await this.tick();
        if (processed === 0) {
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (err) {
        this.logger.error(`outbox tick error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async tick(): Promise<number> {
    // 1) Claim em uma transação (SKIP LOCKED): publica com múltiplos publishers sem duplicar trabalho
    const claimedIds = await this.em.transactional(async (em) => {
      const rows = (await em.getConnection().execute(
        `select id from outbox_messages
         where published_at is null
           and (next_attempt_at is null or next_attempt_at <= now())
         order by occurred_at
         limit 10
         for update skip locked`,
      )) as Array<{ id: string }>;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await em.getConnection().execute(
        `update outbox_messages set next_attempt_at = now() + interval '30 seconds' where id in (${ids.map(() => '?').join(',')})`,
        ids,
      );
      return ids;
    });

    if (claimedIds.length === 0) return 0;

    for (const id of claimedIds) {
      this.inFlight += 1;
      try {
        await this.publishOne(id);
      } finally {
        this.inFlight -= 1;
      }
    }
    return claimedIds.length;
  }

  private async publishOne(id: string): Promise<void> {
    const orm = await this.em.fork().findOne(OutboxMessageOrmEntity, { id });
    if (!orm || orm.publishedAt) return;
    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(orm.payload),
          MessageGroupId: orm.aggregateId,
          MessageDeduplicationId: `${orm.id}:${orm.attempts}`,
        }),
      );
      orm.publishedAt = new Date();
      orm.nextAttemptAt = undefined;
      await this.em.fork().persistAndFlush(orm);
    } catch (err) {
      const em = this.em.fork();
      const row = await em.findOne(OutboxMessageOrmEntity, { id });
      if (row) {
        row.attempts += 1;
        const backoff = Math.min(2 ** row.attempts * 1000, 60_000);
        row.nextAttemptAt = new Date(Date.now() + backoff);
        await em.persistAndFlush(row);
      }
      this.logger.error(`publish failed for ${id}: ${(err as Error).message}`);
    }
  }
}
