import { Entity, PrimaryKey, Property, Index, Unique, Enum } from '@mikro-orm/core';
import { WagerTransactionKind } from '../../../domain/wagering/enums/wager-kind.enum';
import { WagerTransactionStatus } from '../../../domain/wagering/enums/transaction-status.enum';
import { FailureCode } from '../../../domain/shared/errors/failure-code.enum';

@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['idempotencyKey'] })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
@Index({ properties: ['status'] })
@Index({ properties: ['walletId'] })
@Index({ properties: ['providerId', 'referenceExternalTransactionId'] })
export class WagerTransactionOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'text' })
  providerId!: string;

  @Property({ type: 'text' })
  externalTransactionId!: string;

  @Property({ type: 'text' })
  idempotencyKey!: string;

  @Property({ type: 'text' })
  payloadHash!: string;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'uuid' })
  playerId!: string;

  @Property({ type: 'text' })
  roundId!: string;

  @Property({ type: 'text' })
  gameId!: string;

  @Enum({ items: () => WagerTransactionKind, nativeEnumName: 'wager_transaction_kind' })
  kind!: WagerTransactionKind;

  @Property({ type: 'decimal', precision: 20, scale: 2 })
  moneyAmount!: string;

  @Property({ type: 'text' })
  currency!: string;

  @Property({ type: 'text', nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ type: 'uuid', nullable: true })
  referenceTransactionId?: string;

  @Enum({ items: () => WagerTransactionStatus, nativeEnumName: 'wager_transaction_status' })
  status!: WagerTransactionStatus;

  @Enum({ items: () => FailureCode, nullable: true, nativeEnumName: 'failure_code' })
  failureCode?: FailureCode;

  @Property({ type: 'timestamptz', nullable: true })
  processedAt?: Date;

  @Property({ type: 'decimal', precision: 20, scale: 2, nullable: true })
  responseBalanceAmount?: string;

  @Property({ type: 'text', nullable: true })
  responseBalanceCurrency?: string;

  @Property({ type: 'integer', default: 0 })
  referenceAttempts = 0;

  @Property({ type: 'timestamptz', nullable: true })
  referenceNextAttemptAt?: Date;

  @Property({ type: 'timestamptz' })
  createdAt!: Date;
}
