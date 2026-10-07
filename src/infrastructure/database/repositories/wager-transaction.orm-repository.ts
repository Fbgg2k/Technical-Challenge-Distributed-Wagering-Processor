import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransaction } from '../../../domain/wagering/entities/wager-transaction.entity';
import { WagerTransactionOrmEntity } from '../entities/wager-transaction.orm-entity';
import { FailureCode } from '../../../domain/shared/errors/failure-code.enum';
import { WagerTransactionStatus } from '../../../domain/wagering/enums/transaction-status.enum';

export class WagerTransactionOrmRepository {
  constructor(private readonly em: EntityManager) {}

  private toDomain(orm: WagerTransactionOrmEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: orm.id,
      providerId: orm.providerId,
      externalTransactionId: orm.externalTransactionId,
      idempotencyKey: orm.idempotencyKey,
      payloadHash: orm.payloadHash,
      walletId: orm.walletId,
      playerId: orm.playerId,
      roundId: orm.roundId,
      gameId: orm.gameId,
      kind: orm.kind,
      moneyAmount: orm.moneyAmount,
      currency: orm.currency,
      referenceExternalTransactionId: orm.referenceExternalTransactionId,
      referenceTransactionId: orm.referenceTransactionId ?? undefined,
      status: orm.status,
      failureCode: orm.failureCode as FailureCode | undefined,
      processedAt: orm.processedAt,
      responseBalanceAmount: orm.responseBalanceAmount,
      responseBalanceCurrency: orm.responseBalanceCurrency,
      referenceAttempts: orm.referenceAttempts,
      referenceNextAttemptAt: orm.referenceNextAttemptAt,
      createdAt: orm.createdAt,
    });
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    const orm = await this.em.findOne(WagerTransactionOrmEntity, { id });
    return orm ? this.toDomain(orm) : null;
  }

  async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const orm = await this.em.findOne(WagerTransactionOrmEntity, { idempotencyKey: key });
    return orm ? this.toDomain(orm) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const orm = await this.em.findOne(WagerTransactionOrmEntity, {
      providerId,
      externalTransactionId,
    });
    return orm ? this.toDomain(orm) : null;
  }

  async findPendingReferences(limit: number): Promise<WagerTransaction[]> {
    const orms = await this.em.find(
      WagerTransactionOrmEntity,
      { status: WagerTransactionStatus.PendingReference },
      { limit },
    );
    return orms.map((o) => this.toDomain(o));
  }

  async save(tx: WagerTransaction): Promise<void> {
    let orm = await this.em.findOne(WagerTransactionOrmEntity, { id: tx.id });
    if (!orm) {
      orm = this.em.create(WagerTransactionOrmEntity, {
        id: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        idempotencyKey: tx.idempotencyKey,
        payloadHash: tx.payloadHash,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        moneyAmount: tx.money.toDecimalString(),
        currency: tx.money.currency,
        referenceExternalTransactionId: tx.referenceExternalTransactionId,
        referenceTransactionId: tx.referenceTransactionId,
        status: tx.status,
        failureCode: tx.failureCode,
        processedAt: tx.processedAt,
        responseBalanceAmount: tx.responseBalance?.toDecimalString(),
        responseBalanceCurrency: tx.responseBalance?.currency,
        referenceAttempts: tx.referenceAttempts,
        referenceNextAttemptAt: tx.referenceNextAttemptAt,
        createdAt: tx.createdAt,
      });
      this.em.persist(orm);
    } else {
      orm.status = tx.status;
      orm.failureCode = tx.failureCode;
      orm.processedAt = tx.processedAt;
      orm.referenceTransactionId = tx.referenceTransactionId;
      if (tx.responseBalance) {
        orm.responseBalanceAmount = tx.responseBalance.toDecimalString();
        orm.responseBalanceCurrency = tx.responseBalance.currency;
      }
      orm.referenceAttempts = tx.referenceAttempts;
      orm.referenceNextAttemptAt = tx.referenceNextAttemptAt;
    }
    await this.em.flush();
  }
}
