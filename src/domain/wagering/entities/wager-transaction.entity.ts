import { Money } from '../../wallet/value-objects/money.vo';
import { WagerTransactionKind } from '../enums/wager-kind.enum';
import { WagerTransactionStatus } from '../enums/transaction-status.enum';
import { FailureCode } from '../../shared/errors/failure-code.enum';
import {
  InvalidTransactionStateError,
  InvalidPayloadError,
} from '../../shared/errors/domain.error';
import { LedgerDirection } from '../../ledger/enums/ledger-direction.enum';

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  moneyAmount: string;
  currency: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  referenceAttempts?: number;
  referenceNextAttemptAt?: Date;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  processedAt?: Date;
  createdAt: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _referenceAttempts = 0,
    private _referenceNextAttemptAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new InvalidPayloadError('OPENING cannot be submitted externally');
    }
    if (props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback) {
      if (!props.referenceExternalTransactionId) {
        throw new InvalidPayloadError(`${props.kind} requires referenceExternalTransactionId`);
      }
    }
    if (props.money.isNegative()) {
      throw new InvalidPayloadError('money amount cannot be negative');
    }
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static createOpening(props: {
    id: string;
    walletId: string;
    playerId: string;
    money: Money;
    payloadHash: string;
  }): WagerTransaction {
    const tx = new WagerTransaction(
      props.id,
      'internal',
      `opening-${props.walletId}`,
      `internal:opening:${props.walletId}`,
      props.payloadHash,
      props.walletId,
      props.playerId,
      `opening-${props.walletId}`,
      'wallet-opening',
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      new Date(),
      WagerTransactionStatus.Pending,
    );
    return tx;
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from({ amount: state.moneyAmount, currency: state.currency }),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.referenceAttempts ?? 0,
      state.referenceNextAttemptAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }
  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }
  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }
  get processedAt(): Date | undefined {
    return this._processedAt;
  }
  get referenceAttempts(): number {
    return this._referenceAttempts;
  }
  get referenceNextAttemptAt(): Date | undefined {
    return this._referenceNextAttemptAt;
  }
  get requiresReference(): boolean {
    return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._referenceNextAttemptAt = undefined;
  }

  markPendingReference(): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.PendingReference;
    this._referenceNextAttemptAt = new Date();
  }

  /** Registra uma tentativa de resolver a referência e agenda a próxima com backoff exponencial. */
  scheduleReferenceRetry(now: Date, maxAttempts: number): boolean {
    this._referenceAttempts += 1;
    if (this._referenceAttempts >= maxAttempts) {
      return false;
    }
    const backoff = Math.min(2 ** this._referenceAttempts * 1000, 60_000);
    this._referenceNextAttemptAt = new Date(now.getTime() + backoff);
    return true;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback:
        if (!reference) {
          throw new InvalidPayloadError('ROLLBACK requires reference');
        }
        return reference.ledgerDirectionFor() === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        throw new InvalidPayloadError('LOSS does not produce ledger entry');
    }
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `transaction ${this.id} is terminal (${this._status})`,
      );
    }
  }
}
