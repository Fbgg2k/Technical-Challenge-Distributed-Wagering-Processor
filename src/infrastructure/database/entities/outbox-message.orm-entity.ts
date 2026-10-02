import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core';

@Entity({ tableName: 'outbox_messages' })
@Index({ properties: ['publishedAt', 'nextAttemptAt'] })
export class OutboxMessageOrmEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  aggregateId!: string;

  @Property({ type: 'text' })
  eventType!: string;

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Property({ type: 'timestamptz' })
  occurredAt!: Date;

  @Property({ type: 'integer' })
  attempts!: number;

  @Property({ type: 'timestamptz', nullable: true })
  nextAttemptAt?: Date;

  @Property({ type: 'timestamptz', nullable: true })
  publishedAt?: Date;
}
