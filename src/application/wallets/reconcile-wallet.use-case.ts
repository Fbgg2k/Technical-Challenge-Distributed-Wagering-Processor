import { Injectable } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { WalletOrmEntity } from '../../infrastructure/database/entities/wallet.orm-entity';
import { WalletLedgerEntryOrmEntity } from '../../infrastructure/database/entities/wallet-ledger-entry.orm-entity';
import { WalletOrmRepository } from '../../infrastructure/database/repositories/wallet.orm-repository';
import { metrics } from '../../infrastructure/observability/metrics/metrics.service';

@Injectable()
export class ReconcileWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string) {
    return this.em.transactional(async (em) => {
      const walletOrm = await em.findOne(
        WalletOrmEntity,
        { id: walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!walletOrm) {
        throw new Error('wallet not found');
      }

      const rows = await em.find(WalletLedgerEntryOrmEntity, { walletId });
      let calculatedNumerator = 0n;
      for (const row of rows) {
        const cents = Math.round(Number(row.moneyAmount) * 100);
        calculatedNumerator += row.direction === 'CREDIT' ? BigInt(cents) : -BigInt(cents);
      }
      const calculatedAmount = `${calculatedNumerator / 100n}.${(calculatedNumerator % 100n).toString().padStart(2, '0')}`;

      const storedCents = Math.round(Number(walletOrm.balanceAmount) * 100);
      const differenceNumerator = BigInt(storedCents) - calculatedNumerator;
      const differenceAmount = `${differenceNumerator / 100n}.${(differenceNumerator % 100n).toString().padStart(2, '0')}`;
      const consistent = differenceNumerator === 0n;

      if (!consistent) {
        // Divergência NUNCA é corrigida silenciosamente: log + métrica + flag na resposta.
        metrics.reconciliationDivergences.inc();
        process.stdout.write(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            context: 'ReconcileWalletUseCase',
            message: 'ledger/wallet balance divergence',
            walletId,
            storedBalance: walletOrm.balanceAmount,
            calculatedBalance: calculatedAmount,
          }) + '\n',
        );
      }

      return {
        walletId,
        storedBalance: { amount: walletOrm.balanceAmount, currency: walletOrm.currency },
        calculatedBalance: { amount: calculatedAmount, currency: walletOrm.currency },
        difference: { amount: differenceAmount, currency: walletOrm.currency },
        consistent,
        checkedEntries: rows.length,
      };
    });
  }
}
