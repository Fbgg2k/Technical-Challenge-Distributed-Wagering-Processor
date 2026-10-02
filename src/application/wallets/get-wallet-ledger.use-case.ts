import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/database/entities/wallet-ledger-entry.orm-entity';

@Injectable()
export class GetWalletLedgerUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string, cursor?: string, limit = 50) {
    const where: Record<string, unknown> = { walletId };
    let rows: WalletLedgerEntryOrmEntity[];
    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf8');
      const [createdAtRaw, id] = decoded.split('|');
      const createdAt = new Date(createdAtRaw);
      rows = await this.em
        .createQueryBuilder(WalletLedgerEntryOrmEntity, 'e')
        .where({ walletId })
        .andWhere(
          '(e.created_at, e.id) < (?, ?)',
          [createdAt.toISOString(), id],
        )
        .orderBy({ createdAt: 'DESC', id: 'DESC' })
        .limit(limit)
        .execute() as unknown as WalletLedgerEntryOrmEntity[];
    } else {
      rows = await this.em.find(
        WalletLedgerEntryOrmEntity,
        where as never,
        { limit, orderBy: { createdAt: 'DESC', id: 'DESC' } },
      );
    }

    const nextCursor =
      rows.length === limit
        ? Buffer.from(`${rows[rows.length - 1].createdAt.toISOString()}|${rows[rows.length - 1].id}`).toString('base64')
        : undefined;

    return {
      data: rows.map((r) => ({
        id: r.id,
        transactionId: r.transactionId,
        direction: r.direction,
        money: { amount: r.moneyAmount, currency: r.currency },
        balanceBefore: { amount: r.balanceBeforeAmount, currency: r.currency },
        balanceAfter: { amount: r.balanceAfterAmount, currency: r.currency },
        createdAt: r.createdAt,
      })),
      nextCursor,
    };
  }
}
