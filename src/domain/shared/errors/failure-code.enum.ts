export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceInvalid = 'REFERENCE_INVALID',
  DuplicateReversal = 'DUPLICATE_REVERSAL',
  AmountMismatch = 'AMOUNT_MISMATCH',
  NegativeBalanceReversal = 'NEGATIVE_BALANCE_REVERSAL',
  PayloadConflict = 'PAYLOAD_CONFLICT',
  InvalidKind = 'INVALID_KIND',
  WalletNotFound = 'WALLET_NOT_FOUND',
  InternalError = 'INTERNAL_ERROR',
}
