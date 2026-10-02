import { Money, InvalidMoneyError } from '../value-objects/money.vo';

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: { id: string; playerId: string; initialBalance: Money }): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new InvalidMoneyError('initial balance cannot be negative');
    }
    const now = new Date();
    const wallet = new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
    return wallet;
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from({ amount: state.balanceAmount, currency: state.currency }),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(money: Money): void {
    this.assertSameCurrency(money);
    const next = this._balance.subtract(money);
    if (next.isNegative()) {
      throw new InsufficientFundsError(
        `insufficient funds: balance ${this._balance} < debit ${money}`,
      );
    }
    if (!next.equals(this._balance)) {
      this._balance = next;
      this._version += 1;
      this._updatedAt = new Date();
    }
  }

  credit(money: Money): void {
    this.assertSameCurrency(money);
    const next = this._balance.add(money);
    if (!next.equals(this._balance)) {
      this._balance = next;
      this._version += 1;
      this._updatedAt = new Date();
    }
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new InvalidMoneyError(
        `wallet currency ${this.currency} does not match operation ${money.currency}`,
      );
    }
  }
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balanceAmount: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}
