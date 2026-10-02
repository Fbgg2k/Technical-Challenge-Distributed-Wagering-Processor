import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { Wallet } from '../../domain/wallet/entities/wallet.entity';
import { Money } from '../../domain/wallet/value-objects/money.vo';
import { WagerTransaction } from '../../domain/wagering/entities/wager-transaction.entity';
import { WagerTransactionKind } from '../../domain/wagering/enums/wager-kind.enum';
import { WagerTransactionStatus } from '../../domain/wagering/enums/transaction-status.enum';
import { WalletLedgerEntry } from '../../domain/ledger/entities/ledger-entry.entity';
import { LedgerDirection } from '../../domain/ledger/enums/ledger-direction.enum';
import { FailureCode } from '../../domain/shared/errors/failure-code.enum';
import { OutboxMessage } from '../../domain/messaging/entities/outbox-message.entity';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
  WalletBalanceChanged,
} from '../../domain/messaging/events/events';
import { WalletOrmRepository } from '../../infrastructure/database/repositories/wallet.orm-repository';
import { WagerTransactionOrmRepository } from '../../infrastructure/database/repositories/wager-transaction.orm-repository';
import { LedgerEntryOrmRepository } from '../../infrastructure/database/repositories/ledger-entry.orm-repository';
import { WalletOrmEntity } from '../../infrastructure/database/entities/wallet.orm-entity';
import { WagerTransactionOrmEntity } from '../../infrastructure/database/entities/wager-transaction.orm-entity';
import { OutboxMessageOrmEntity } from '../../infrastructure/database/entities/outbox-message.orm-entity';
import { canonicalPayloadHash } from '../shared/payload-hash';

export interface ProcessTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
  correlationId?: string;
}

export interface ProcessTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  balance?: { amount: string; currency: string };
  idempotentReplay: boolean;
}

const BUSINESS_FIELDS = [
  'providerId',
  'externalTransactionId',
  'playerId',
  'walletId',
  'roundId',
  'gameId',
  'kind',
  'money',
  'referenceExternalTransactionId',
] as const;

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: ProcessTransactionInput): Promise<ProcessTransactionResult> {
    let money: Money;
    try {
      money = Money.from(input.money);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    if (money.isNegative()) {
      throw new BadRequestException('money.amount cannot be negative');
    }
    if (input.kind === WagerTransactionKind.Opening) {
      throw new BadRequestException('OPENING cannot be submitted via API/queue');
    }
    if (
      (input.kind === WagerTransactionKind.Refund || input.kind === WagerTransactionKind.Rollback) &&
      !input.referenceExternalTransactionId
    ) {
      throw new BadRequestException(`${input.kind} requires referenceExternalTransactionId`);
    }

    const payloadSubset: Record<string, unknown> = {};
    for (const key of BUSINESS_FIELDS) {
      const value = (input as unknown as Record<string, unknown>)[key];
      if (value !== undefined) payloadSubset[key] = value;
    }
    const payloadHash = canonicalPayloadHash(payloadSubset);

    try {
      return await this.em.transactional(async (em) => {
      const txRepo = new WagerTransactionOrmRepository(em);
      const walletRepo = new WalletOrmRepository(em);
      const ledgerRepo = new LedgerEntryOrmRepository(em);

      // ---- Idempotência persistente ----
      const existing = await txRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (existing.matchesPayload(payloadHash)) {
          const wallet = await walletRepo.findById(existing.walletId);
          return {
            transactionId: existing.id,
            status: existing.status,
            failureCode: existing.failureCode,
            balance: wallet?.balance.toJSON(),
            idempotentReplay: true,
          };
        }
        throw new ConflictException('idempotency key conflict: different payload');
      }

      const sameExternal = await txRepo.findByProviderAndExternalId(
        input.providerId,
        input.externalTransactionId,
      );
      if (sameExternal) {
        if (sameExternal.idempotencyKey === input.idempotencyKey && sameExternal.matchesPayload(payloadHash)) {
          const wallet = await walletRepo.findById(sameExternal.walletId);
          return {
            transactionId: sameExternal.id,
            status: sameExternal.status,
            failureCode: sameExternal.failureCode,
            balance: wallet?.balance.toJSON(),
            idempotentReplay: true,
          };
        }
        throw new ConflictException('transaction already exists with different idempotency key');
      }

      // ---- Lock pessimista por wallet (unidade de concorrência) ----
      const walletOrm = await em.findOne(
        WalletOrmEntity,
        { id: input.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!walletOrm) {
        throw new BadRequestException('wallet not found');
      }
      const wallet = Wallet.rehydrate({
        id: walletOrm.id,
        playerId: walletOrm.playerId,
        currency: walletOrm.currency,
        balanceAmount: walletOrm.balanceAmount,
        version: walletOrm.version,
        createdAt: walletOrm.createdAt,
        updatedAt: walletOrm.updatedAt,
      });

      const tx = WagerTransaction.create({
        id: randomUUID(),
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
      });

      const reject = async (code: FailureCode): Promise<ProcessTransactionResult> => {
        tx.reject(code);
        await txRepo.save(tx);
        await this.enqueue(em, WagerTransactionRejected.from(tx, { correlationId: input.correlationId ?? tx.id }));
        return {
          transactionId: tx.id,
          status: tx.status,
          failureCode: code,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
        };
      };

      // ---- Validações de ownership/moeda ----
      if (wallet.playerId !== input.playerId) {
        return reject(FailureCode.ReferenceInvalid);
      }
      if (input.money.currency !== wallet.currency) {
        return reject(FailureCode.CurrencyMismatch);
      }

      switch (tx.kind) {
        case WagerTransactionKind.Bet: {
          try {
            const before = wallet.balance;
            wallet.debit(money);
            const entry = WalletLedgerEntry.create({
              id: randomUUID(),
              walletId: wallet.id,
              transactionId: tx.id,
              direction: LedgerDirection.Debit,
              money,
              balanceBefore: before,
              balanceAfter: wallet.balance,
            });
            tx.markProcessed(undefined, new Date());
            await walletRepo.save(wallet);
            await txRepo.save(tx);
            await ledgerRepo.save(entry);
            await this.afterProcessed(em, tx, wallet, entry, input.correlationId);
            return {
              transactionId: tx.id,
              status: tx.status,
              balance: wallet.balance.toJSON(),
              idempotentReplay: false,
            };
          } catch (err) {
            if ((err as Error).name === 'InsufficientFundsError') {
              return reject(FailureCode.InsufficientFunds);
            }
            throw err;
          }
        }
        case WagerTransactionKind.Win: {
          const before = wallet.balance;
          wallet.credit(money);
          const entry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: LedgerDirection.Credit,
            money,
            balanceBefore: before,
            balanceAfter: wallet.balance,
          });
          tx.markProcessed(undefined, new Date());
          await walletRepo.save(wallet);
          await txRepo.save(tx);
          await ledgerRepo.save(entry);
          await this.afterProcessed(em, tx, wallet, entry, input.correlationId);
          return {
            transactionId: tx.id,
            status: tx.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }
        case WagerTransactionKind.Loss: {
          tx.markProcessed(undefined, new Date());
          await txRepo.save(tx);
          await this.enqueue(em, WagerTransactionProcessed.from(tx, { correlationId: input.correlationId ?? tx.id }));
          return {
            transactionId: tx.id,
            status: tx.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }
        case WagerTransactionKind.Refund:
        case WagerTransactionKind.Rollback: {
          return this.processReversal(em, tx, wallet, input, money, reject);
        }
        default:
          throw new BadRequestException('unsupported kind');
      }
    });
    } catch (err) {
      // Concorrência: outro request commitou a mesma idempotencyKey primeiro.
      if (this.isUniqueViolation(err)) {
        const existing = await new WagerTransactionOrmRepository(this.em).findByIdempotencyKey(
          input.idempotencyKey,
        );
        if (existing && existing.matchesPayload(payloadHash)) {
          const wallet = await new WalletOrmRepository(this.em).findById(existing.walletId);
          return {
            transactionId: existing.id,
            status: existing.status,
            failureCode: existing.failureCode,
            balance: wallet?.balance.toJSON(),
            idempotentReplay: true,
          };
        }
        throw new ConflictException('idempotency key conflict: different payload');
      }
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; message?: string; cause?: { code?: string } };
    return e?.code === '23505' || e?.cause?.code === '23505' || /duplicate key|unique/i.test(e?.message ?? '');
  }

  private async processReversal(
    em: EntityManager,
    tx: WagerTransaction,
    wallet: Wallet,
    input: ProcessTransactionInput,
    money: Money,
    reject: (code: FailureCode) => Promise<ProcessTransactionResult>,
  ): Promise<ProcessTransactionResult> {
    const txRepo = new WagerTransactionOrmRepository(em);
    const walletRepo = new WalletOrmRepository(em);
    const ledgerRepo = new LedgerEntryOrmRepository(em);

    const reference = await txRepo.findByProviderAndExternalId(
      input.providerId,
      input.referenceExternalTransactionId!,
    );

    if (!reference) {
      tx.markPendingReference();
      await txRepo.save(tx);
      await this.enqueue(em, WagerTransactionPendingReference.from(tx, { correlationId: input.correlationId ?? tx.id }));
      return {
        transactionId: tx.id,
        status: tx.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    // ---- Validações da referência ----
    if (
      reference.providerId !== input.providerId ||
      reference.playerId !== input.playerId ||
      reference.walletId !== input.walletId ||
      reference.roundId !== input.roundId ||
      reference.money.currency !== input.money.currency
    ) {
      return reject(FailureCode.ReferenceInvalid);
    }
    if (reference.status !== WagerTransactionStatus.Processed) {
      return reject(FailureCode.ReferenceInvalid);
    }
    if (tx.kind === WagerTransactionKind.Refund && reference.kind !== WagerTransactionKind.Bet) {
      return reject(FailureCode.ReferenceInvalid);
    }
    if (
      tx.kind === WagerTransactionKind.Rollback &&
      ![WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund].includes(reference.kind)
    ) {
      return reject(FailureCode.ReferenceInvalid);
    }
    if (!reference.money.equals(money)) {
      return reject(FailureCode.AmountMismatch);
    }

    // ---- Reversão duplicada pelo mesmo tipo ----
    const sameTypeReversals = await em.find(
      WagerTransactionOrmEntity,
      { kind: tx.kind, referenceTransactionId: reference.id, status: WagerTransactionStatus.Processed },
    );
    if (sameTypeReversals.length > 0) {
      return reject(FailureCode.DuplicateReversal);
    }

    const direction = tx.ledgerDirectionFor(reference);
    const before = wallet.balance;
    try {
      if (direction === LedgerDirection.Credit) {
        wallet.credit(money);
      } else {
        wallet.debit(money);
      }
    } catch (err) {
      if ((err as Error).name === 'InsufficientFundsError') {
        return reject(FailureCode.NegativeBalanceReversal);
      }
      throw err;
    }

    const entry = WalletLedgerEntry.create({
      id: randomUUID(),
      walletId: wallet.id,
      transactionId: tx.id,
      direction,
      money,
      balanceBefore: before,
      balanceAfter: wallet.balance,
    });
    tx.markProcessed(reference.id, new Date());
    await walletRepo.save(wallet);
    await txRepo.save(tx);
    await ledgerRepo.save(entry);
    await this.afterProcessed(em, tx, wallet, entry, input.correlationId);
    return {
      transactionId: tx.id,
      status: tx.status,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
    };
  }

  private async afterProcessed(
    em: EntityManager,
    tx: WagerTransaction,
    wallet: Wallet,
    entry: WalletLedgerEntry,
    correlationId?: string,
  ): Promise<void> {
    const ctx = { correlationId: correlationId ?? tx.id };
    await this.enqueue(em, WagerTransactionProcessed.from(tx, ctx));
    await this.enqueue(em, WalletBalanceChanged.from(wallet, entry, ctx));
  }

  private async enqueue(em: EntityManager, event: Parameters<typeof OutboxMessage.enqueue>[0]): Promise<void> {
    const outbox = OutboxMessage.enqueue(event);
    const orm = em.create(OutboxMessageOrmEntity, {
      id: outbox.id,
      aggregateId: outbox.aggregateId,
      eventType: outbox.eventType,
      payload: outbox.payload as Record<string, unknown>,
      occurredAt: outbox.occurredAt,
      attempts: outbox.attempts,
      nextAttemptAt: outbox.nextAttemptAt,
      publishedAt: outbox.publishedAt,
    });
    em.persist(orm);
    await em.flush();
  }
}
