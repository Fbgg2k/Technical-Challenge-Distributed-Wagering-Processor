import Decimal from 'decimal.js';

export interface MoneyProps {
  amount: string; // decimal string, ex.: "25.00"
  currency: string; // ISO-4217
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    return Money.build(props.amount, props.currency);
  }

  static zero(currency: string): Money {
    return new Money(new Decimal(0), Money.assertCurrency(currency));
  }

  private static build(amount: string, currency: string): Money {
    Money.assertCurrency(currency);
    if (typeof amount !== 'string' || amount.trim() === '') {
      throw new InvalidMoneyError('amount must be a non-empty string');
    }
    if (/[eE]/.test(amount)) {
      throw new InvalidMoneyError('scientific notation is not allowed');
    }
    if (!/^-?\d+(\.\d+)?$/.test(amount)) {
      throw new InvalidMoneyError(`invalid amount: "${amount}"`);
    }
    const decimals = amount.split('.')[1]?.length ?? 0;
    if (decimals > 2) {
      throw new InvalidMoneyError('amount must have at most 2 decimal places');
    }
    const value = new Decimal(amount);
    if (!value.isFinite()) {
      throw new InvalidMoneyError('amount must be finite');
    }
    return new Money(value.toDecimalPlaces(2), currency);
  }

  private static assertCurrency(currency: string): string {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      throw new InvalidMoneyError(`invalid currency: "${currency}"`);
    }
    return currency;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value).toDecimalPlaces(2), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value).toDecimalPlaces(2), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated().toDecimalPlaces(2), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toDecimalString(): string {
    return this.value.toFixed(2);
  }

  toJSON(): MoneyProps {
    return { amount: this.toDecimalString(), currency: this.currency };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new InvalidMoneyError(
        `currency mismatch: ${this.currency} vs ${other.currency}`,
      );
    }
  }
}
