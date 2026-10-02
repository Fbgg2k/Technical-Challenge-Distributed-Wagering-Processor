import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionStatus } from '../../../domain/wagering/enums/transaction-status.enum';
import { ProcessWagerTransactionUseCase } from '../../../application/wagering/process-wager-transaction.use-case';

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private stopRequested = false;

  constructor(private readonly em: EntityManager) {}

  onModuleInit(): void {
    if (process.env.PENDING_REFERENCE_WORKER_ENABLED !== 'true') {
      this.logger.log('pending-reference worker disabled');
      return;
    }
    void this.loop();
    this.logger.log('pending-reference worker started');
  }

  async onModuleDestroy(): Promise<void> {
    this.stopRequested = true;
  }

  private async loop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        const processed = await this.tick();
        if (processed === 0) await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        this.logger.error(`tick error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async tick(): Promise<number> {
    const due = await this.em.transactional(async (em) => {
      const rows = (await em.getConnection().execute(
        `select id from wager_transactions
         where status = ?
           and (reference_next_attempt_at is null or reference_next_attempt_at <= now())
         order by created_at
         limit 10
         for update skip locked`,
        [WagerTransactionStatus.PendingReference],
      )) as Array<{ id: string }>;
      return rows.map((r) => r.id);
    });

    for (const id of due) {
      try {
        await new ProcessWagerTransactionUseCase(this.em.fork()).retryPendingReference(id);
      } catch (err) {
        this.logger.error(`retry failed for ${id}: ${(err as Error).message}`);
      }
    }
    return due.length;
  }
}
