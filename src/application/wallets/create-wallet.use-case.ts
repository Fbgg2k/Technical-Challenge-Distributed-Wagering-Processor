import { ConflictException, BadRequestException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { Wallet } from '../../domain/wallet/entities/wallet.entity';
import { Money } from '../../domain/wallet/value-objects/money.vo';
import { WagerTransaction } from '../../domain/wagering/entities/wager-transaction.entity';
import { WalletLedgerEntry } from '../../domain/ledger/entities/ledger-entry.entity';
import { LedgerDirection } from '../../domain/ledger/enums/ledger-direction.enum';
import { WalletOrmRepository } from '../../infrastructure/database/repositories/wallet.orm-repository';
import { WagerTransactionOrmRepository } from '../../infrastructure/database/repositories/wager-transaction.orm-repository';
import { LedgerEntryOrmRepository } from '../../infrastructure/database/repositories/ledger-entry.orm-repository';
import { canonicalPayloadHash } from '../shared/payload-hash';

export interface CreateWalletInput {
  playerId: string;
  initialBalance: { amount: string; currency: string };
}

export class CreateWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: CreateWalletInput) {
    let initial: Money;
    try {
      initial = Money.from(input.initialBalance);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    if (initial.isNegative()) {
      throw new BadRequestException('initialBalance cannot be negative');
    }

    return this.em.transactional(async (em) => {
      const walletRepo = new WalletOrmRepository(em);
      const txRepo = new WagerTransactionOrmRepository(em);
      const ledgerRepo = new LedgerEntryOrmRepository(em);

      const existing = await walletRepo.findByPlayerAndCurrency(
        input.playerId,
        initial.currency,
      );
      if (existing) {
        throw new ConflictException('wallet already exists for playerId + currency');
      }

      const wallet = Wallet.open({
        id: randomUUID(),
        playerId: input.playerId,
        initialBalance: initial,
      });
      await walletRepo.save(wallet);

      if (initial.isPositive()) {
        const txId = randomUUID();
        const payloadHash = canonicalPayloadHash({
          walletId: wallet.id,
          playerId: wallet.playerId,
          kind: 'OPENING',
          money: initial.toJSON(),
        });
        const opening = WagerTransaction.createOpening({
          id: txId,
          walletId: wallet.id,
          playerId: wallet.playerId,
          money: initial,
          payloadHash,
        });
        opening.markProcessed(undefined, new Date());
        await txRepo.save(opening);

        const entry = WalletLedgerEntry.create({
          id: randomUUID(),
          walletId: wallet.id,
          transactionId: txId,
          direction: LedgerDirection.Credit,
          money: initial,
          balanceBefore: Money.zero(initial.currency),
          balanceAfter: initial,
        });
        await ledgerRepo.save(entry);
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
