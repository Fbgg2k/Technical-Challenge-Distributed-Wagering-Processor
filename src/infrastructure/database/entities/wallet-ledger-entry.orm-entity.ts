import { Entity, PrimaryKey, Property, Index, Enum, Unique } from '@mikro-orm/core';
import { LedgerDirection } from '../../../domain/ledger/enums/ledger-direction.enum';

@Entity({ tableName: 'wallet_ledger_entries' })
@Unique({ properties: ['transactionId', 'walletId'] })
@Index({ properties: ['walletId'] })
export class WalletLedgerEntryOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'uuid' })
  transactionId!: string;

  @Enum({ items: () => LedgerDirection, nativeEnumName: 'ledger_direction' })
  direction!: LedgerDirection;

  @Property({ type: 'decimal', precision: 20, scale: 2 })
  moneyAmount!: string;

  @Property({ type: 'text' })
  currency!: string;

  @Property({ type: 'decimal', precision: 20, scale: 2 })
  balanceBeforeAmount!: string;

  @Property({ type: 'decimal', precision: 20, scale: 2 })
  balanceAfterAmount!: string;

  @Property({ type: 'timestamptz' })
  createdAt!: Date;
}
