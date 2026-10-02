import { EntityManager } from '@mikro-orm/postgresql';
import { WalletLedgerEntry } from '../../../domain/ledger/entities/ledger-entry.entity';
import { WalletLedgerEntryOrmEntity } from '../entities/wallet-ledger-entry.orm-entity';

export class LedgerEntryOrmRepository {
  constructor(private readonly em: EntityManager) {}

  async save(entry: WalletLedgerEntry): Promise<void> {
    const orm = this.em.create(WalletLedgerEntryOrmEntity, {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      moneyAmount: entry.money.toDecimalString(),
      currency: entry.money.currency,
      balanceBeforeAmount: entry.balanceBefore.toDecimalString(),
      balanceAfterAmount: entry.balanceAfter.toDecimalString(),
      createdAt: entry.createdAt,
    });
    this.em.persist(orm);
    await this.em.flush();
  }

  async listByWallet(walletId: string, cursor?: string, limit = 50): Promise<WalletLedgerEntryOrmEntity[]> {
    const where: Record<string, unknown> = { walletId };
    if (cursor) {
      where.id = { $lt: cursor };
    }
    return this.em.find(
      WalletLedgerEntryOrmEntity,
      where as never,
      { limit, orderBy: { createdAt: 'DESC', id: 'DESC' } },
    );
  }
}
