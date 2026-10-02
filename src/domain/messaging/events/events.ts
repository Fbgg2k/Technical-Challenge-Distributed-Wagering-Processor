import { IntegrationEvent, EventContext } from './integration-event';
import { Wallet } from '../../wallet/entities/wallet.entity';
import { WagerTransaction } from '../../wagering/entities/wager-transaction.entity';
import { WalletLedgerEntry } from '../../ledger/entities/ledger-entry.entity';
import { LedgerDirection } from '../../ledger/enums/ledger-direction.enum';
import { MoneyProps } from '../../wallet/value-objects/money.vo';
import { WagerTransactionKind } from '../../wagering/enums/wager-kind.enum';
import { FailureCode } from '../../shared/errors/failure-code.enum';

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(wallet: Wallet, entry: WalletLedgerEntry, ctx: EventContext): WalletBalanceChanged {
    return new (class extends WalletBalanceChanged {})({
      eventId: crypto.randomUUID(),
      aggregateId: wallet.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}

export interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  walletId: string;
  playerId: string;
  roundId: string;
  status: 'PROCESSED';
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(tx: WagerTransaction, ctx: EventContext): WagerTransactionProcessed {
    return new (class extends WagerTransactionProcessed {})({
      eventId: crypto.randomUUID(),
      aggregateId: tx.walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        transactionId: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        kind: tx.kind,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        status: 'PROCESSED',
      },
    });
  }
}

export interface WagerTransactionRejectedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  failureCode: FailureCode;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(tx: WagerTransaction, ctx: EventContext): WagerTransactionRejected {
    return new (class extends WagerTransactionRejected {})({
      eventId: crypto.randomUUID(),
      aggregateId: tx.walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        transactionId: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        failureCode: tx.failureCode!,
      },
    });
  }
}

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  referenceExternalTransactionId?: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(tx: WagerTransaction, ctx: EventContext): WagerTransactionPendingReference {
    return new (class extends WagerTransactionPendingReference {})({
      eventId: crypto.randomUUID(),
      aggregateId: tx.walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        transactionId: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        referenceExternalTransactionId: tx.referenceExternalTransactionId,
      },
    });
  }
}
