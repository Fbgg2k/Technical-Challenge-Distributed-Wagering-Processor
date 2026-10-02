import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core';

@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'] })
export class WalletOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  playerId!: string;

  @Property({ type: 'text' })
  currency!: string;

  @Property({ type: 'decimal', precision: 20, scale: 2 })
  balanceAmount!: string;

  @Property({ type: 'integer' })
  version!: number;

  @Property({ type: 'timestamptz' })
  createdAt!: Date;

  @Property({ type: 'timestamptz', onUpdate: () => new Date() })
  updatedAt!: Date;
}
