export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_TRANSACTION_STATE');
  }
}

export class InvalidPayloadError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_PAYLOAD');
  }
}
